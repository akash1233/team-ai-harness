import { createServerFn } from "@tanstack/react-start";
import type { ExecutionConfig, GrillQuestion, Plan, SlackPost, StepAgent, TeamDoc, Ticket, JiraIssue, WorkflowColumn } from "./types";
import { mergeJiraIssues, type JiraConnection, type LinkedJira } from "./connectors";
import { buildContext } from "./flow-context";
import { resolveFlowStagePrompt } from "./flow-spec";
import {
  COLUMNS,
  FILE_JIRA_COLUMN_ID,
  FRY_COLUMN_ID,
  PLAN_JSON_END,
  PLAN_JSON_START,
  SEND_SLACK_COLUMN_ID,
  SYNTHESIZE_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
  columnById,
} from "./columns";
import { fallbackFor } from "./agent-fallbacks";
import { formatKindlingTerminalTitle } from "./cli-session";
import { createDefaultExecution } from "./team-config";

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
      grill?: { frontierEmpty: boolean; questions: GrillQuestion[] };
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
  grillSubmit?: boolean;
  promptTemplate?: string;
  promptId?: string;
  execution?: ExecutionConfig;
  stepAgent?: StepAgent;
  docs?: TeamDoc[];
  jira?: JiraConnection;
  jiraKeys?: string[];
  jiraIssues?: LinkedJira[];
  columns?: WorkflowColumn[];
  promptOverride?: StagePayload;
};

export function extractPlan(text: string): Plan | undefined {
  const start = text.indexOf(PLAN_JSON_START);
  const end = text.indexOf(PLAN_JSON_END);
  if (start < 0 || end < 0 || end <= start) return undefined;
  const raw = text.slice(start + PLAN_JSON_START.length, end).trim();
  try {
    const parsed = JSON.parse(raw) as Plan;
    if (!parsed || !Array.isArray(parsed.steps)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function extractGrill(text: string): { frontierEmpty: boolean; questions: GrillQuestion[] } | undefined {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fence?.[1]?.trim() ?? (text.trim().startsWith("{") ? text.trim() : "");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      frontierEmpty?: boolean;
      conclusions?: string;
      questions?: Array<{ n?: number; question?: string; recommended?: string; source?: string }>;
    };
    const questions: GrillQuestion[] = (parsed.questions ?? []).map((q, i) => ({
      n: q.n ?? i + 1,
      question: String(q.question ?? ""),
      recommended: String(q.recommended ?? ""),
      answer: "",
      source: q.source ? String(q.source) : "spec",
    }));
    return { frontierEmpty: Boolean(parsed.frontierEmpty), questions };
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
    grillSubmit,
    promptTemplate,
    docs,
    jira,
    jiraKeys = [],
    jiraIssues = [],
    columns = COLUMNS,
    promptOverride,
  } = data;
  const issues = await resolveJiraIssues(ticket.linkedJiras ?? [], jiraIssues, jiraKeys, jira);
  const promptTicket = { ...ticket, linkedJiras: issues };
  const fromFlow = resolveFlowStagePrompt(columnId, promptTicket, docs, { grillSubmit });
  let prompt: { system: string; user: string; max: number };

  if (fromFlow) {
    prompt = fromFlow;
  } else if (columnId === FILE_JIRA_COLUMN_ID) {
    prompt = {
      max: 4000,
      system: promptTemplate || "Create Jira issues from the approved plan only.",
      user: ticket.plan ? JSON.stringify(ticket.plan, null, 2) : "(no approved plan)",
    };
  } else {
    const col = columnById(columnId, columns);
    const ctx = buildContext(promptTicket, docs);
    prompt = {
      max: 4000,
      system: "You are a pipeline stage. Reply with the stage output only — the final answer, no preamble.",
      user: ctx.input || ctx.context || col?.promptTemplate || "",
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
    const { ticket, columnId, grillSubmit, promptId, execution, stepAgent, promptOverride } = data;
    const runId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `run-${Date.now()}`;

    const { prompt } = await resolveStagePayload(data);
    const input = recordedInput(prompt.system, prompt.user);

    if (columnId === FILE_JIRA_COLUMN_ID) {
      if (!ticket.plan?.steps?.length) {
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
      let filingPlan = ticket.plan;
      try {
        const edited = JSON.parse(prompt.user) as Plan;
        if (Array.isArray(edited.steps)) filingPlan = edited;
      } catch {
        return {
          ok: false,
          error: "Edited Jira payload must be valid plan JSON",
          input,
        };
      }
      if (!filingPlan.steps.length) {
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
      const base = Number(ticket.key.split("-")[1] || "800");
      let n = base + 12;
      const jira: JiraIssue[] = filingPlan.steps.map((step) => {
        n += 1;
        const kind = step.title.toLowerCase().startsWith("epic") ? "epic" : "story";
        return { key: `X2-${n}`, title: step.title, kind };
      });
      const text = jira.map((j) => `${j.key}  ${j.title}`).join("\n");
      return {
        ok: true,
        text: `Created:\n${text}`,
        input,
        summary: `Filed ${jira.length} issues`,
        spend: 0,
        runId,
        jira,
      };
    }

    if (columnId === SEND_SLACK_COLUMN_ID) {
      const ctx = buildContext(ticket, data.docs);
      if (!ctx.slackChannelId?.trim()) {
        return {
          ok: false,
          error: "Missing Slack channel ID — set it in Brief or Team Settings",
          input,
        };
      }
      if (!ctx.slackMessage?.trim()) {
        return {
          ok: false,
          error: "Missing agenda message — run Agenda and approve it before Notify",
          input,
        };
      }
    }

    const notifyExecution: ExecutionConfig | undefined =
      columnId === SEND_SLACK_COLUMN_ID
        ? {
            ...(execution ?? createDefaultExecution()),
            fullAgentMode: true,
            runInTerminal: true,
            demoFallbacks: false,
          }
        : execution;

    const stageCol = columnById(columnId, data.columns);
    const terminalTitle = stageCol ? formatKindlingTerminalTitle(stageCol.label) : undefined;

    const { runModel } = await import("./execution.server");
    const live = await runModel({
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.max,
      execution: notifyExecution,
      promptId,
      stepAgent,
      terminalTitle,
    });
    if (live.sessionDir) {
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
    const fb = fallbackFor(ticket, columnId, grillSubmit);
    const timedOut = !live.ok && /^Timed out after/.test(live.error || "");
    const useDemo =
      columnId === SEND_SLACK_COLUMN_ID || timedOut
        ? false
        : !live.ok && (notifyExecution?.demoFallbacks ?? execution?.demoFallbacks ?? true);
    if (!live.ok && !useDemo) {
      return { ok: false, error: live.error || "Agent failed", via: live.via, input };
    }
    const text = live.ok && live.text.trim() ? live.text.trim() : fb.text;
    const via = live.ok ? live.via : "demo";
    const spend = live.ok && !useDemo ? live.spend ?? 0 : 0;

    const plan = columnId === WRITE_PLAN_COLUMN_ID ? extractPlan(text) ?? fb.plan : undefined;
    const grill = columnId === FRY_COLUMN_ID ? extractGrill(text) ?? fb.grill : undefined;

    const summary =
      columnId === FRY_COLUMN_ID
        ? grill?.frontierEmpty
          ? "Fryme complete"
          : `Grill round (${grill?.questions.length ?? 0} questions)`
        : columnId === WRITE_PLAN_COLUMN_ID
          ? "Plan drafted"
          : columnId === SYNTHESIZE_COLUMN_ID
            ? "Spec synthesized"
            : columnId === SEND_SLACK_COLUMN_ID
              ? "Notify run"
              : "Agent response";

    return {
      ok: true,
      text,
      input,
      summary,
      spend,
      runId,
      plan,
      grill,
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
