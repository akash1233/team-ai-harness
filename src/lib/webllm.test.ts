import assert from "node:assert/strict";
import { test } from "node:test";
import { stripThinkBlocks } from "./cli-session.ts";
import { resolveStep, shortAgent, stepLabel } from "./agents.ts";
import { SEND_SLACK_COLUMN_ID } from "./columns.ts";
import { DEFAULT_PRICING, ratesFor } from "./pricing.ts";
import { mergeExecution } from "./team-config.ts";
import type { ExecutionConfig } from "./types.ts";
import {
  isDefaultWebllmModel,
  normalizeWebllmModelIds,
  resolveWebllmModel,
  resolveWebllmProfile,
  stageUsesWebllm,
  webllmBlockedReason,
  withoutRuntimeCallbacks,
} from "./webllm.ts";

const exec: ExecutionConfig = {
  defaultAgent: "webllm",
  cursorTarget: "local",
  claudeTarget: "local",
  cursorCommand: "agent -p",
  claudeCommand: "claude -p",
  localHttpUrl: "",
  cursorRemoteUrl: "",
  claudeRemoteUrl: "",
  studioBaseUrl: "",
  featureKey: "",
  promptId: "",
  cisProvider: "aws",
  cisModel: "x",
  cisTaskType: "aws-converse-v1",
  timeoutMs: 120000,
  demoFallbacks: true,
  pricing: DEFAULT_PRICING,
  webllmProfile: "balanced",
  webllmModelId: "",
};

test("WebLLM is a first-class agent kind", () => {
  const step = resolveStep({ agent: "webllm" }, exec);
  assert.equal(step.kind, "webllm");
  assert.equal(step.target, "local");
  assert.match(step.label, /WebLLM/);
  assert.equal(shortAgent("webllm"), "WebLLM");
  assert.equal(stepLabel("webllm", "local"), "WebLLM");
});

test("inherit uses workspace WebLLM default", () => {
  const step = resolveStep({ agent: "inherit", role: "prompt" }, exec);
  assert.equal(step.kind, "webllm");
  assert.match(step.label, /Balanced/);
});

test("stage profile Fast overrides workspace Balanced", () => {
  const model = resolveWebllmModel({ webllmProfile: "fast" }, exec);
  assert.equal(model.id, "fast");
  assert.equal(model.label, "Fast");
  assert.match(model.modelId, /1\.7B/);
});

test("custom workspace model applies when the stage does not pin a profile", () => {
  const custom = resolveWebllmModel({}, { ...exec, webllmModelId: "Qwen3-0.6B-q4f16_1-MLC" });
  assert.equal(custom.modelId, "Qwen3-0.6B-q4f16_1-MLC");
  assert.equal(custom.custom, true);
  const pinned = resolveWebllmModel({ webllmProfile: "quality" }, { ...exec, webllmModelId: "Qwen3-0.6B-q4f16_1-MLC" });
  assert.match(pinned.modelId, /8B/);
  assert.equal(pinned.custom, false);
});

test("Notify cannot run WebLLM", () => {
  assert.match(webllmBlockedReason(SEND_SLACK_COLUMN_ID) ?? "", /slack-mcp/);
  assert.equal(webllmBlockedReason("prep-agenda"), undefined);
});

test("Cursor still resolves for Notify and pinned Cursor stages", () => {
  const notify = resolveStep({ agent: "cursor", id: SEND_SLACK_COLUMN_ID, role: "prompt" }, exec);
  assert.equal(notify.kind, "cursor");
  assert.equal(notify.target, "local");
  assert.match(notify.label, /Cursor/);
});

test("stageUsesWebllm follows pin then inherit", () => {
  assert.equal(stageUsesWebllm({ agent: "webllm", role: "prompt" }, exec), true);
  assert.equal(stageUsesWebllm({ agent: "inherit", role: "prompt" }, exec), true);
  assert.equal(stageUsesWebllm({ agent: "cursor", role: "prompt" }, exec), false);
  assert.equal(stageUsesWebllm({ agent: "inherit", role: "collect-input" }, exec), false);
  assert.equal(stageUsesWebllm({ agent: "inherit", role: "review" }, exec), false);
  assert.equal(stageUsesWebllm({ agent: "inherit", role: "approve" }, exec), false);
});

test("Quality profile is the 8B model", () => {
  assert.match(resolveWebllmProfile({ webllmProfile: "quality" }).modelId, /8B/);
});

test("WebLLM spend is zero", () => {
  const rates = ratesFor("webllm", DEFAULT_PRICING);
  assert.equal(rates.inputUsdPerMTok, 0);
  assert.equal(rates.outputUsdPerMTok, 0);
});

test("mergeExecution keeps a saved WebLLM profile", () => {
  const merged = mergeExecution({ webllmProfile: "fast", defaultAgent: "webllm" });
  assert.equal(merged.webllmProfile, "fast");
  assert.equal(merged.defaultAgent, "webllm");
  assert.equal(mergeExecution({ webllmProfile: "nope" as never }).webllmProfile, "balanced");
});

test("default Fast/Balanced/Quality model ids are recognized", () => {
  assert.equal(isDefaultWebllmModel("Qwen3-4B-q4f16_1-MLC"), true);
  assert.equal(isDefaultWebllmModel("Llama-3.2-1B-Instruct-q4f16_1-MLC"), false);
});

test("normalizeWebllmModelIds drops defaults, blanks, and duplicates", () => {
  assert.deepEqual(
    normalizeWebllmModelIds(["", "Qwen3-4B-q4f16_1-MLC", "Llama-3.2-1B-Instruct-q4f16_1-MLC", "Llama-3.2-1B-Instruct-q4f16_1-MLC"]),
    ["Llama-3.2-1B-Instruct-q4f16_1-MLC"],
  );
});

test("mergeExecution keeps pulled extra model ids", () => {
  const merged = mergeExecution({ webllmExtraModelIds: ["  Phi-3.5-mini-instruct-q4f16_1-MLC  ", "Phi-3.5-mini-instruct-q4f16_1-MLC"] });
  assert.deepEqual(merged.webllmExtraModelIds, ["Phi-3.5-mini-instruct-q4f16_1-MLC"]);
});

test("WebLLM runtime queues a second job behind the active download", async () => {
  const {
    enqueueWebllmJob,
    finishWebllmJob,
    getWebllmRuntime,
    resetWebllmRuntime,
    updateWebllmJob,
  } = await import("./webllm-runtime.ts");
  resetWebllmRuntime();
  const a = enqueueWebllmJob({ modelId: "Qwen3-8B", text: "Downloading", columnLabel: "Spec", ticketKey: "X2-1" });
  const b = enqueueWebllmJob({ modelId: "Qwen3-1.7B", text: "Waiting", columnLabel: "Agenda", ticketKey: "X2-2" });
  let snap = getWebllmRuntime();
  assert.equal(snap.active?.id, a);
  assert.equal(snap.active?.phase, "load");
  assert.equal(snap.queue.length, 1);
  assert.equal(snap.queue[0]?.id, b);
  assert.equal(snap.queue[0]?.phase, "queued");
  updateWebllmJob(a, { pct: 40, text: "shard 3/8 · 40%" });
  assert.equal(getWebllmRuntime().active?.pct, 40);
  finishWebllmJob(a);
  snap = getWebllmRuntime();
  assert.equal(snap.active?.id, b);
  assert.equal(snap.active?.phase, "load");
  assert.equal(snap.queue.length, 0);
  finishWebllmJob(b);
  assert.equal(getWebllmRuntime().active?.phase, "done");
  assert.equal(getWebllmRuntime().active?.pct, 100);
  const { loadDisplayPct, webllmPublicStatus } = await import("./webllm-runtime.ts");
  assert.equal(loadDisplayPct(100), 90);
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "load", pct: 34, text: "shard 2/8" }).label, "Downloading");
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "load", pct: 34, text: "Loading Qwen3-1.7B from browser cache." }).label, "From cache");
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "generate", text: "Qwen3-1.7B already in this tab." }).label, "Writing");
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "load", pct: 34, text: "shard 2/8" }).pct, 34);
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "load", pct: 100, text: "done?" }).pct, 90);
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "generate", text: "token dump" }).label, "Writing");
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "generate", text: "token dump" }).indeterminate, true);
  assert.equal(webllmPublicStatus({ id: "1", modelId: "x", phase: "done", pct: 100, text: "Done" }).pct, 100);
  resetWebllmRuntime();
});

test("WebLLM harvest reuses stripThinkBlocks so think never becomes the spec", () => {
  assert.equal(
    stripThinkBlocks("<think>\nplan the sections\n</think>\n\nProblem: voice agenda\n\nRecord the full meeting."),
    "Problem: voice agenda\n\nRecord the full meeting.",
  );
});

test("takeWebllmStreamLog throttles Node INFO and skips think until flushed", async () => {
  const { takeWebllmStreamLog, WEBLLM_STREAM_MIN_CHARS, WEBLLM_STREAM_MIN_MS } = await import("./webllm-engine.ts");
  const burst = "x".repeat(WEBLLM_STREAM_MIN_CHARS);
  const ready = { lastVisible: "", lastAt: 0, thought: false };
  assert.deepEqual(takeWebllmStreamLog(ready, burst, 1), { chars: burst.length, delta: burst });

  const state = { lastVisible: "", lastAt: 0, thought: false };
  assert.deepEqual(takeWebllmStreamLog(state, "<think>plan", 1), { chars: 0, thinking: true });
  assert.equal(takeWebllmStreamLog(state, "<think>plan more", 2), null);
  assert.equal(takeWebllmStreamLog(state, "Hi", 3), null);
  const first = takeWebllmStreamLog(state, "Hi there, this is enough visible text to flush.", 3, true);
  assert.equal(first?.chars, "Hi there, this is enough visible text to flush.".length);
  assert.equal(first?.delta, "Hi there, this is enough visible text to flush.");
  assert.equal(takeWebllmStreamLog(state, "Hi there, this is enough visible text to flush. More.", 4), null);
  const later = takeWebllmStreamLog(
    state,
    "Hi there, this is enough visible text to flush. More.",
    4 + WEBLLM_STREAM_MIN_MS,
    true,
  );
  assert.equal(later?.delta, " More.");
});

test("withoutRuntimeCallbacks drops functions so Seroval can serialize the server payload", () => {
  const onProgress = () => {};
  const onLog = () => {};
  const payload = withoutRuntimeCallbacks({
    columnId: "prep-agenda",
    promptOverride: { system: "s", user: "u" },
    onProgress,
    onLog,
  });
  assert.equal("onProgress" in payload, false);
  assert.equal("onLog" in payload, false);
  assert.equal(payload.columnId, "prep-agenda");
  assert.equal(JSON.stringify(payload), JSON.stringify({ columnId: "prep-agenda", promptOverride: { system: "s", user: "u" } }));
});
