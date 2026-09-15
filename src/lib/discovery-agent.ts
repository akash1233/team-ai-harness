import { createServerFn } from "@tanstack/react-start";
import type { ExecutionConfig, FryQuestion, Plan, SlackPost, StepAgent, TeamDoc, Ticket, JiraIssue, WorkflowColumn } from "./types";
import { mergeJiraIssues, type JiraConnection, type LinkedJira } from "./connectors";
import { buildContext, interpolate } from "./flow-context";
import { resolveFlowStagePrompt } from "./flow-spec";
import {
  COLUMNS,
  FILE_JIRA_COLUMN_ID,
  PLAN_JSON_END,
  PLAN_JSON_START,
  SEND_SLACK_COLUMN_ID,
  SYNTHESIZE_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
  columnById,
  isFryStage,
} from "./columns";
import { fallbackFor } from "./agent-fallbacks";
import { resolveStageCli } from "./agents";
import { formatKindlingTerminalTitle, stripThinkBlocks } from "./cli-session";
import { extractFileJiraMcpResult, jiraProjectFromKey } from "./discovery-jira";
import { createDefaultExecution } from "./team-config";
import { clip, getLogBuffer, getLogLevel, startCall } from "./logger";

export type AgentResult =
  | {
      ok: true;
      text: string;
      /** Resolved prompt sent to the agent, recorded in run history. */
      input?: string;
      summary: string;
      spend: number;
      runId: string;
      blocked?: string;
      plan?: Plan;
      slack?: SlackPost;
      jira?: JiraIssue[];
      fry?: { frontierEmpty: boolean; questions: FryQuestion[]; conclusions?: string };
      via?: string;
      usage?: { inputTokens: number; outputTokens: number; estimated: boolean };
      sessionDir?: string;
    }
  | { ok: false; error: string; via?: string; input?: string };

/** localStorage holds the whole board, so a full prompt per run would blow the quota. */
const MAX_INPUT_CHARS = 4000;

function recordedInput(system: string, user: string): string {
  const text = [system, user].filter((part) => part.trim()).join("\n\n");
  return text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}\n…truncated` : text;
}

/**
 * Ticket issues plus the ones bound to the stage prompt, refreshed from Jira
 * when a PAT is configured. A failed refresh keeps the catalog snapshot.
 */
async function resolveJiraIssues(
  ticketIssues: LinkedJira[],
  promptIssues: LinkedJira[],
  promptKeys: string[],
  jira?: JiraConnection,
): Promise<LinkedJira[]> {
  const issues = mergeJiraIssues(ticketIssues, promptIssues);
  const keys = [...new Set([...issues.map((issue) => issue.key), ...promptKeys].map((key) => key.toUpperCase()))];
  if (!jira?.baseUrl.trim() || !jira.token.trim() || !keys.length) return issues;

  const { getJiraIssue } = await import("./connectors.server");
  const refreshed = await Promise.all(keys.map((key) => getJiraIssue(jira, key)));
  const byKey = new Map(issues.map((issue) => [issue.key.toUpperCase(), issue]));
  for (const result of refreshed) {
    if (result.ok && result.issue) byKey.set(result.issue.key.toUpperCase(), result.issue);
  }
  return keys.flatMap((key) => {
    const issue = byKey.get(key);
    return issue ? [issue] : [];
  });
}

export type StagePayload = { system: string; user: string };

export type AgentInput = {
  ticket: Ticket;
  columnId: string;
  frySubmit?: boolean;
  promptTemplate?: string;
  promptId?: string;
  execution?: ExecutionConfig;
  stepAgent?: StepAgent;
  docs?: TeamDoc[];
  jira?: JiraConnection;
  jiraKeys?: string[];
  jiraIssues?: LinkedJira[];
  jiraComponents?: string;
  columns?: WorkflowColumn[];
  promptOverride?: StagePayload;
};

function parsePlanJson(raw: string): Plan | undefined {
  try {
    const parsed = JSON.parse(raw) as Plan;
    if (!parsed || !Array.isArray(parsed.steps)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function extractPlan(text: string): Plan | undefined {
  const start = text.indexOf(PLAN_JSON_START);
  const end = text.indexOf(PLAN_JSON_END);
  if (start >= 0 && end > start) {
    const fenced = parsePlanJson(text.slice(start + PLAN_JSON_START.length, end).trim());
    if (fenced) return fenced;
  }
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence?.[1]?.trim() ?? (trimmed.startsWith("{") ? trimmed : "");
  return candidate ? parsePlanJson(candidate) : undefined;
}

export function extractFry(
  text: string,
): { frontierEmpty: boolean; questions: FryQuestion[]; conclusions?: string } | undefined {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fence?.[1]?.trim() ?? (text.trim().startsWith("{") ? text.trim() : "");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      frontierEmpty?: boolean;
      conclusions?: string;
      questions?: Array<{ n?: number; question?: string; recommended?: string; source?: string }>;
    };
    const questions: FryQuestion[] = (parsed.questions ?? []).map((q, i) => ({
      n: q.n ?? i + 1,
      question: String(q.question ?? ""),
      recommended: String(q.recommended ?? ""),
      answer: "",
      source: q.source ? String(q.source) : "spec",
    }));
    const conclusions = typeof parsed.conclusions === "string" ? parsed.conclusions.trim() : "";
    return {
      frontierEmpty: Boolean(parsed.frontierEmpty),
      questions,
      ...(conclusions ? { conclusions } : {}),
    };
  } catch {
    return undefined;
  }
}

async function resolveStagePayload(data: AgentInput): Promise<{
  prompt: { system: string; user: string; max: number };
  issues: LinkedJira[];
}> {
  const {
    ticket,
    columnId,
    frySubmit,
    promptTemplate,
    docs,
    jira,
    jiraKeys = [],
    jiraIssues = [],
    jiraComponents,
    columns = COLUMNS,
    promptOverride,
  } = data;
  const issues = await resolveJiraIssues(ticket.linkedJiras ?? [], jiraIssues, jiraKeys, jira);
  const project = (jira?.project || "").trim().toUpperCase() || jiraProjectFromKey(ticket.key);
  const team = { jiraComponents };
  const promptTicket = {
    ...ticket,
    linkedJiras: issues,
    vars: {
      ...ticket.vars,
      ...(project && !ticket.vars?.jiraProject ? { jiraProject: project } : {}),
    },
  };
  const fromFlow = resolveFlowStagePrompt(columnId, promptTicket, docs, { frySubmit, promptTemplate, team });
  let prompt: { system: string; user: string; max: number };

  if (fromFlow) {
    prompt = fromFlow;
  } else {
    const col = columnById(columnId, columns);
    const ctx = buildContext(promptTicket, docs, team);
    const template = promptTemplate || col?.promptTemplate || "";
    prompt = {
      max: 4000,
      system: "You are a pipeline stage. Reply with the stage output only — the final answer, no preamble.",
      user: interpolate(template, ctx).trim() || ctx.input || ctx.context || "",
    };
  }

  return {
    issues,
    prompt: promptOverride ? { ...prompt, ...promptOverride } : prompt,
  };
}

export const previewStagePrompt = createServerFn({ method: "POST" })
  .validator((input: AgentInput) => input)
  .handler(async ({ data }): Promise<StagePayload> => {
    const { prompt } = await resolveStagePayload({ ...data, promptOverride: undefined });
    return { system: prompt.system, user: prompt.user };
  });

export const runDiscoveryAgent = createServerFn({ method: "POST" })
  .validator((input: AgentInput) => input)
  .handler(async ({ data }): Promise<AgentResult> => {
    const { ticket, columnId, frySubmit, promptId, execution, stepAgent, promptOverride } = data;
    const runId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `run-${Date.now()}`;

    const span = startCall("exec.stage", {
      columnId,
      ticket: ticket.key,
      stepAgent: stepAgent ?? "inherit",
      runId,
    });
    const { prompt } = await resolveStagePayload(data);
    const input = recordedInput(prompt.system, prompt.user);
    span.log.debug("prompt", { chars: input.length, prompt: clip(input) });

    if (columnId === FILE_JIRA_COLUMN_ID) {
      if (!ticket.plan?.steps?.length) {
        span.fail("no approved plan", { via: "file-jira", blocked: true });
        return {
          ok: true,
          text: "",
          input,
          summary: "Blocked",
          spend: 0,
          runId,
          blocked: "no approved plan",
        };
      }
    }

    if (columnId === SEND_SLACK_COLUMN_ID) {
      const ctx = buildContext(ticket, data.docs);
      if (!ctx.slackChannelId?.trim()) {
        const error = "Missing Slack channel ID — set it in Brief or Team Settings";
        span.fail(error);
        return { ok: false, error, input };
      }
      if (!ctx.slackMessage?.trim()) {
        const error = "Missing agenda message — run Agenda and approve it before Notify";
        span.fail(error);
        return { ok: false, error, input };
      }
    }

    const stageCol = columnById(columnId, data.columns);
    const terminalTitle = stageCol ? formatKindlingTerminalTitle(stageCol.label) : undefined;
    const mcpStage = columnId === SEND_SLACK_COLUMN_ID || columnId === FILE_JIRA_COLUMN_ID;
    const mcpExecution: ExecutionConfig | undefined = mcpStage
      ? { ...(execution ?? createDefaultExecution()), demoFallbacks: false }
      : execution;
    const mcpAgent: StepAgent | undefined = columnId === FILE_JIRA_COLUMN_ID ? "cursor" : stepAgent;

    const { runModel } = await import("./execution.server");
    const live = await runModel({
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.max,
      execution: mcpExecution,
      promptId,
      stepAgent: mcpAgent,
      cliMode: resolveStageCli(stageCol),
      terminalTitle,
    });
    if (live.sessionDir) {
      span.ok({ via: live.via, sessionDir: live.sessionDir, pending: true });
      return {
        ok: true,
        text: live.text,
        input,
        summary: "Session open in Terminal",
        spend: 0,
        runId,
        via: live.via,
        sessionDir: live.sessionDir,
      };
    }
    const fb = fallbackFor(ticket, columnId, frySubmit);
    const timedOut = !live.ok && /^Timed out after/.test(live.error || "");
    const useDemo =
      mcpStage || timedOut
        ? false
        : !live.ok && (mcpExecution?.demoFallbacks ?? execution?.demoFallbacks ?? true);
    if (!live.ok && !useDemo) {
      span.fail(live.error || "Agent failed", { via: live.via });
      return { ok: false, error: live.error || "Agent failed", via: live.via, input };
    }
    const text = stripThinkBlocks(live.ok && live.text.trim() ? live.text.trim() : fb.text);
    const via = live.ok ? live.via : "demo";
    const spend = live.ok && !useDemo ? live.spend ?? 0 : 0;

    const plan = columnId === WRITE_PLAN_COLUMN_ID ? extractPlan(text) ?? fb.plan : undefined;
    const fry = isFryStage(columnId) ? extractFry(text) ?? fb.fry : undefined;
    const filed =
      columnId === FILE_JIRA_COLUMN_ID
        ? extractFileJiraMcpResult(text, ticket.plan, {
            project: jiraProjectFromKey(ticket.key) || data.jira?.project,
            excludeKeys: [ticket.key, ...(ticket.linkedJiras ?? []).map((issue) => issue.key)],
          })
        : undefined;
    const jira: JiraIssue[] | undefined = filed?.issues.length ? filed.issues : undefined;

    const summary =
      isFryStage(columnId)
        ? fry?.frontierEmpty
          ? "Fry Me complete"
          : `Fry Me round (${fry?.questions.length ?? 0} questions)`
        : columnId === WRITE_PLAN_COLUMN_ID
          ? "Plan drafted"
          : columnId === SYNTHESIZE_COLUMN_ID
            ? "Spec synthesized"
            : columnId === SEND_SLACK_COLUMN_ID
              ? "Notify run"
              : columnId === FILE_JIRA_COLUMN_ID
                ? jira?.length
                  ? `Filed ${jira.length} Jira issues`
                  : "File Jira run"
                : "Agent response";

    span.ok({ via, chars: text.length, demo: via === "demo", issues: jira?.length });
    return {
      ok: true,
      text: filed?.found ? filed.display : text,
      input,
      summary,
      spend,
      runId,
      plan,
      fry,
      jira,
      via,
      usage: live.ok && !useDemo ? live.usage : undefined,
    };
  });

export const flushLiveSession = createServerFn({ method: "POST" })
  .validator(
    (input: { sessionDir: string; columnId?: string; hasSlackMessage?: boolean }) => input,
  )
  .handler(async ({ data }) => {
    const exec = await import("./execution.server");
    return exec.pollAgentTest(data.sessionDir, {
      longSession: true,
      columnId: data.columnId,
      hasSlackMessage: data.hasSlackMessage,
    });
  });

export const inspectCliBins = createServerFn({ method: "POST" })
  .validator((input: { execution?: ExecutionConfig }) => input)
  .handler(async ({ data }) => {
    const exec = await import("./execution.server");
    return exec.inspectCliBins(data.execution);
  });

export const readAppLogs = createServerFn({ method: "POST" })
  .validator((input?: unknown) => input ?? {})
  .handler(async () => {
    return {
      level: getLogLevel(),
      lines: getLogBuffer().map((r) => r.line),
    };
  });

export const appendAppLogs = createServerFn({ method: "POST" })
  .validator((input: { lines?: string[] }) => input)
  .handler(async ({ data }) => {
    const { ingestLogLines } = await import("./logger");
    ingestLogLines(data.lines ?? []);
    return { ok: true as const };
  });

export const testExecution = createServerFn({ method: "POST" })
  .validator(
    (input: {
      execution?: ExecutionConfig;
      stepAgent?: StepAgent;
      mode?: "connect" | "run";
      prompt?: string;
      mcp?: boolean;
      mcpServer?: string;
      phase?: "start" | "poll";
      sessionDir?: string;
      longSession?: boolean;
      columnId?: string;
      hasSlackMessage?: boolean;
    }) => input,
  )
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      via: string;
      text: string;
      error?: string;
      checks?: { ok: boolean; label: string; detail: string }[];
      sessionDir?: string;
      log?: string;
      done?: boolean;
    }> => {
      try {
        const exec = await import("./execution.server");
        if (data.phase === "poll" && data.sessionDir) {
          const poll = await exec.pollAgentTest(data.sessionDir, {
            longSession: data.longSession,
            columnId: data.columnId,
            hasSlackMessage: data.hasSlackMessage,
          });
          return {
            ok: poll.ok,
            via: "session",
            text: poll.log.slice(-400),
            error: poll.error,
            log: poll.log,
            done: poll.done,
          };
        }
        const result = await exec.startAgentTest({
          execution: data.execution,
          stepAgent: data.stepAgent,
          mode: data.mode,
          prompt: data.prompt,
          mcp: data.mcp,
          mcpServer: data.mcpServer,
        });
        return {
          ok: result.ok,
          via: result.via,
          text: result.text.slice(0, 800),
          error: result.error,
          checks: result.checks,
          sessionDir: result.sessionDir,
          log: result.log,
          done: !result.sessionDir,
        };
      } catch (err) {
        return {
          ok: false,
          via: "executor",
          text: "",
          error: err instanceof Error ? err.message : "Setup check failed",
          done: true,
        };
      }
    },
  );
