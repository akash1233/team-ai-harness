import { fallbackFor } from "./agent-fallbacks.ts";
import {
  extractGrill,
  extractPlan,
  previewStagePrompt,
  type AgentInput,
  type AgentResult,
} from "./discovery-agent.ts";
import {
  FILE_JIRA_COLUMN_ID,
  FRY_COLUMN_ID,
  SEND_SLACK_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
  columnById,
} from "./columns.ts";
import { stripThinkBlocks } from "./cli-session.ts";
import { getFlowStage } from "./flow-spec.ts";
import { resolveWebllmModel, webllmBlockedReason, withoutRuntimeCallbacks } from "./webllm.ts";
import { runWebllmCompletion, type WebllmProgress } from "./webllm-engine.ts";
import { clip, startCall } from "./logger.ts";
import { ensureLogFlush } from "./logger-flush.ts";
import { emitAppConsole } from "./app-console.ts";

const MAX_INPUT_CHARS = 4000;

function recordedInput(system: string, user: string): string {
  const text = [system, user].filter((part) => part.trim()).join("\n\n");
  return text.length > MAX_INPUT_CHARS ? `${text.slice(0, MAX_INPUT_CHARS)}\n…truncated` : text;
}

function runId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `run-${Date.now()}`;
}

export async function runWebllmStage(
  data: AgentInput & { onProgress?: (text: string) => void },
): Promise<AgentResult> {
  ensureLogFlush();
  const { ticket, columnId, grillSubmit, execution, promptOverride, onProgress } = data;
  emitAppConsole(
    `[kindling] ${new Date().toISOString()} INFO  exec.stage webllm columnId=${columnId} ticket=${ticket.key}`,
  );
  const id = runId();
  const blocked = webllmBlockedReason(columnId);
  const col = columnById(columnId, data.columns);
  const model = resolveWebllmModel(col, execution);
  const via = `WebLLM · ${model.label}`;
  const span = startCall("exec.stage", {
    kind: "webllm",
    columnId,
    ticket: ticket.key,
    via,
    modelId: model.modelId,
  });

  if (columnId === FILE_JIRA_COLUMN_ID) {
    span.fail("File in Jira is not a WebLLM stage.");
    return { ok: false, error: "File in Jira is not a WebLLM stage.", via, input: "" };
  }
  if (blocked) {
    span.fail(blocked);
    return { ok: false, error: blocked, via, input: "" };
  }

  span.log.info("prompt.resolve");
  const prompt = await previewStagePrompt({
    data: withoutRuntimeCallbacks({ ...data, promptOverride }),
  });
  const input = recordedInput(prompt.system, prompt.user);
  span.log.info("prompt.ready", { chars: input.length });
  const max = getFlowStage(columnId)?.maxTokens ?? 4000;
  const json = columnId === FRY_COLUMN_ID || columnId === WRITE_PLAN_COLUMN_ID;
  span.log.debug("prompt", { chars: input.length, prompt: clip(input), maxTokens: max, json });

  const live = await runWebllmCompletion({
    system: prompt.system,
    user: prompt.user,
    maxTokens: max,
    execution,
    column: col,
    json,
    job: { ticketKey: ticket.key, columnLabel: col?.label || columnId },
    onProgress: (p: WebllmProgress) => {
      if (p.phase === "load" || p.phase === "queued") {
        span.log.info("ui", { phase: p.phase, pct: p.pct });
        onProgress?.(p.pct != null ? `Downloading ${p.pct}%` : "Downloading…");
        return;
      }
      if (p.phase === "generate") {
        onProgress?.(p.text === "Thinking…" ? "Thinking…" : p.text || "Writing…");
        return;
      }
      onProgress?.(p.text);
    },
  });

  const useDemo = !live.ok && (execution?.demoFallbacks ?? true) && columnId !== SEND_SLACK_COLUMN_ID;
  if (!live.ok && !useDemo) {
    span.fail(live.error || "WebLLM failed", { via: live.via });
    return { ok: false, error: live.error || "WebLLM failed", via: live.via, input };
  }

  const fb = fallbackFor(ticket, columnId, grillSubmit);
  const raw = live.ok && live.text.trim() ? live.text.trim() : fb.text;
  const text = stripThinkBlocks(raw);
  const usedVia = live.ok ? live.via : "demo";
  const plan = columnId === WRITE_PLAN_COLUMN_ID ? extractPlan(text) ?? fb.plan : undefined;
  const grill = columnId === FRY_COLUMN_ID ? extractGrill(text) ?? fb.grill : undefined;
  const summary =
    columnId === FRY_COLUMN_ID
      ? grill?.frontierEmpty
        ? "Fryme complete"
        : `Grill round (${grill?.questions.length ?? 0} questions)`
      : columnId === WRITE_PLAN_COLUMN_ID
        ? "Plan drafted"
        : columnId === "synthesize"
          ? "Spec synthesized"
          : columnId === "prep-agenda"
            ? "Agenda drafted"
            : "Agent response";

  span.ok({ via: usedVia, chars: text.length, demo: usedVia === "demo" });
  return {
    ok: true,
    text,
    input,
    summary,
    spend: live.ok && !useDemo ? live.spend : 0,
    runId: id,
    plan,
    grill,
    via: usedVia,
    usage: live.ok && !useDemo ? live.usage : undefined,
  };
}
