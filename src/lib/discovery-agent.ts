import { createServerFn } from "@tanstack/react-start";
import type { ExecutionConfig, GrillQuestion, Plan, SlackPost, StepAgent, TeamDoc, Ticket, JiraIssue } from "./types";
import { formatGrillRecord } from "./grill";
import {
  FILE_JIRA_COLUMN_ID,
  FRY_COLUMN_ID,
  PLAN_JSON_END,
  PLAN_JSON_START,
  PREP_AGENDA_COLUMN_ID,
  SEND_SLACK_COLUMN_ID,
  SYNTHESIZE_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
  columnById,
} from "./columns";
import { fallbackFor } from "./agent-fallbacks";

export type AgentResult =
  | {
      ok: true;
      text: string;
      summary: string;
      spend: number;
      runId: string;
      blocked?: string;
      plan?: Plan;
      slack?: SlackPost;
      jira?: JiraIssue[];
      grill?: { frontierEmpty: boolean; questions: GrillQuestion[] };
      via?: string;
    }
  | { ok: false; error: string };

type AgentInput = {
  ticket: Ticket;
  columnId: string;
  grillSubmit?: boolean;
  promptTemplate?: string;
  promptId?: string;
  execution?: ExecutionConfig;
  stepAgent?: StepAgent;
  docs?: TeamDoc[];
};

function spendFor(tokens: number): number {
  return Math.round((0.04 + tokens / 8000) * 100) / 100;
}

function extractPlan(text: string): Plan | undefined {
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

function extractGrill(text: string): { frontierEmpty: boolean; questions: GrillQuestion[] } | undefined {
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

function buildPrompt(
  ticket: Ticket,
  columnId: string,
  grillSubmit?: boolean,
  promptTemplate?: string,
  docs?: TeamDoc[],
): { system: string; user: string; max: number } {
  const col = columnById(columnId);
  const system = promptTemplate || col?.promptTemplate || "";
  const ideation =
    ticket.outputs.ideation ||
    [
      ticket.slackChannel ? `Slack channel: #${ticket.slackChannel.replace(/^#+/, "")}` : "",
      ticket.slackChannelId ? `Channel ID: ${ticket.slackChannelId}` : "",
      ticket.slackMembers ? `Team members: ${ticket.slackMembers}` : "",
      ticket.ideationNotes,
    ]
      .filter(Boolean)
      .join("\n");

  const header = `Jira ${ticket.key}: ${ticket.title}\n${ticket.description}\nLabels: ${ticket.labels.join(", ") || "none"}`;

  if (columnId === PREP_AGENDA_COLUMN_ID) {
    return {
      max: 1100,
      system,
      user: `${header}\n\nIdeation:\n${ideation || "(none)"}\n\nWrite the agenda now.`,
    };
  }

  if (columnId === SYNTHESIZE_COLUMN_ID) {
    return {
      max: 1400,
      system,
      user: `${header}\n\nIdeation:\n${ideation}\n\nTranscript:\n${ticket.transcript || ticket.outputs.transcript || "(none)"}\n\nWrite the spec using the template in the system prompt.`,
    };
  }

  if (columnId === FRY_COLUMN_ID) {
    const rounds = formatGrillRecord(ticket);
    const phase =
      grillSubmit || ticket.grillRounds.some((r) => r.submitted)
        ? "The team answered the last round. Either ask the next frontier against the spec, or if the tree is settled, set frontierEmpty true and write conclusions planning must honor."
        : "Start round 1. Grill the Synthesize spec. Ask the whole frontier. One recommended answer per question.";
    const docBlock = (docs ?? [])
      .map((d) => `### ${d.title} (${d.kind})\n${d.body}`)
      .join("\n\n");
    return {
      max: 1100,
      system: `${system}

${docBlock}

Return ONLY a JSON object in a json fence with shape:
{"frontierEmpty": boolean, "questions": [{"n": 1, "question": "...", "recommended": "...", "source": "spec"}], "conclusions": "markdown if frontierEmpty"}
3–6 questions per round. No interview small talk.`,
      user: `${header}

## Spec from Synthesize (source of truth)
${ticket.outputs.synthesize || "(missing — grill the Jira problem anyway, then tell the team to run Synthesize)"}

## Transcript (only if the spec is silent)
${ticket.transcript || "(none)"}

## Prior grill
${rounds || "(none)"}

${phase}`,
    };
  }

  if (columnId === WRITE_PLAN_COLUMN_ID) {
    return {
      max: 1600,
      system: `${system}
The JSON must be valid. steps[].title must start with "Epic:" or "Story:". Honor Grill Me answers as binding decisions.`,
      user: `${header}\n\nIdeation:\n${ideation}\n\nSynthesis:\n${ticket.outputs.synthesize || ""}\n\nGrill Me (team answers):\n${formatGrillRecord(ticket) || ticket.outputs.fry || ""}\n\nEmit ${PLAN_JSON_START} then JSON then ${PLAN_JSON_END}. A short prose summary may precede the fence.`,
    };
  }

  return {
    max: 800,
    system: system || "Produce a concise operator-facing result.",
    user: header,
  };
}

export const runDiscoveryAgent = createServerFn({ method: "POST" })
  .validator((input: AgentInput) => input)
  .handler(async ({ data }): Promise<AgentResult> => {
    const { ticket, columnId, grillSubmit, promptTemplate, promptId, execution, stepAgent, docs } = data;
    const runId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `run-${Date.now()}`;

    if (columnId === SEND_SLACK_COLUMN_ID) {
      const channel = ticket.slackChannel.replace(/^#+/, "").trim();
      if (!channel) {
        return {
          ok: true,
          text: "",
          summary: "Blocked",
          spend: 0,
          runId,
          blocked: "no Slack channel in Ideation input",
        };
      }
      const agenda = ticket.outputs["prep-agenda"] || "(no agenda)";
      const ts = `${Math.floor(Date.now() / 1000)}.${String(Date.now() % 1000).padStart(3, "0")}000`;
      const channelId = ticket.slackChannelId || "C0BQMKFR519";
      const text = `Posted to #${channel} (${channelId}) ts=${ts}\n\n${agenda}`;
      return {
        ok: true,
        text,
        summary: `Posted to #${channel}`,
        spend: 0.02,
        runId,
        slack: { channel, channelId, ts },
      };
    }

    if (columnId === FILE_JIRA_COLUMN_ID) {
      if (!ticket.plan?.steps?.length) {
        return {
          ok: true,
          text: "",
          summary: "Blocked",
          spend: 0,
          runId,
          blocked: "no approved plan",
        };
      }
      const base = Number(ticket.key.split("-")[1] || "800");
      let n = base + 12;
      const jira: JiraIssue[] = ticket.plan.steps.map((step) => {
        n += 1;
        const kind = step.title.toLowerCase().startsWith("epic") ? "epic" : "story";
        return { key: `X2-${n}`, title: step.title, kind };
      });
      const text = jira.map((j) => `${j.key}  ${j.title}`).join("\n");
      return {
        ok: true,
        text: `Created:\n${text}`,
        summary: `Filed ${jira.length} issues`,
        spend: 0.05,
        runId,
        jira,
      };
    }

    const prompt = buildPrompt(ticket, columnId, grillSubmit, promptTemplate, docs);
    const { runModel } = await import("./execution.server");
    const live = await runModel({
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.max,
      execution,
      promptId,
      stepAgent,
    });
    const fb = fallbackFor(ticket, columnId, grillSubmit);
    const useDemo = !live.ok && (execution?.demoFallbacks ?? true);
    if (!live.ok && !useDemo) {
      return { ok: false, error: live.error || "Agent failed" };
    }
    const text = live.ok && live.text.trim() ? live.text.trim() : fb.text;
    const via = live.ok ? live.via : "demo";

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
            : "Agent response";

    return {
      ok: true,
      text,
      summary,
      spend: spendFor(text.length),
      runId,
      plan,
      grill,
      via,
    };
  });

export const testExecution = createServerFn({ method: "POST" })
  .validator((input: { execution?: ExecutionConfig; stepAgent?: StepAgent }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; via: string; text: string; error?: string }> => {
    try {
      const { probeModel } = await import("./execution.server");
      const result = await probeModel(data.execution, data.stepAgent);
      return {
        ok: result.ok,
        via: result.via,
        text: result.text.slice(0, 240),
        error: result.error,
      };
    } catch (err) {
      return {
        ok: false,
        via: "executor",
        text: "",
        error: err instanceof Error ? err.message : "Probe failed",
      };
    }
  });
