import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bashSetTerminalTitle,
  ensurePrintMode,
  evaluateLongSessionPoll,
  ensureNotifyMcpSeenAt,
  explainCliFailure,
  formatKindlingTerminalTitle,
  isNoiseLog,
  NOTIFY_MCP_SETTLE_MS,
  notifyMcpSettleMs,
  notifyPostSucceeded,
  resolveCursorModel,
  sanitizeTerminalScriptName,
  sessionExitLineInLog,
  stageOutputFromLog,
  toInteractiveArgs,
  withCursorWorkspace,
  withoutFullAgentMode,
  withNonInteractiveFlags,
} from "./cli-session.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Cursor print mode does not add --trust or -f", () => {
  assert.deepEqual(withNonInteractiveFlags("cursor", ["-p", "--output-format", "text"]), [
    "-p",
    "--output-format",
    "text",
  ]);
});

test("does not duplicate --trust", () => {
  const args = withNonInteractiveFlags("cursor", ["--trust", "-p"]);
  assert.equal(args.filter((a) => a === "--trust").length, 1);
});

test("Claude print mode uses permission-mode default, not auto", () => {
  assert.deepEqual(withNonInteractiveFlags("claude", ["-p"]), ["--permission-mode", "default", "-p"]);
});

test("trust prompt is translated", () => {
  const msg = explainCliFailure("⚠ Workspace Trust Required\nDo you trust the contents of this directory?");
  assert.match(msg, /permissions\.json/);
});

test("interactive mode drops -p and output-format", () => {
  assert.deepEqual(
    toInteractiveArgs(["--trust", "-f", "-p", "--output-format", "text", "--model", "composer-1"]),
    ["--trust", "-f", "--model", "composer-1"],
  );
});

test("withoutFullAgentMode strips yolo, force, and dontAsk", () => {
  assert.deepEqual(withoutFullAgentMode(["--trust", "-f", "--yolo", "-p"]), ["--trust", "-p"]);
  assert.deepEqual(withoutFullAgentMode(["--permission-mode", "dontAsk", "-p"]), ["-p"]);
});

test("ensurePrintMode adds -p when missing", () => {
  assert.deepEqual(ensurePrintMode(["--trust"]), ["-p", "--output-format", "text", "--trust"]);
});

test("composer-1 remaps to auto", () => {
  assert.equal(resolveCursorModel("composer-1"), "auto");
  assert.equal(resolveCursorModel("composer-2.5"), "composer-2.5");
});

test("cursor gets --workspace", () => {
  assert.deepEqual(withCursorWorkspace(["-p"], "/tmp/repo"), ["--workspace", "/tmp/repo", "-p"]);
});

test("stageOutputFromLog drops kindling noise", () => {
  const log = `[kindling] starting\nHello agenda\n[kindling] exit 0\n`;
  assert.equal(stageOutputFromLog(log), "Hello agenda");
});

test("retrieval-only log is noise", () => {
  assert.equal(isNoiseLog("cursor-retrieval: tracing to '/tmp/x.log'"), true);
  assert.equal(isNoiseLog("pong"), false);
});

test("sessionExitLineInLog detects kindling exit marker", () => {
  assert.equal(sessionExitLineInLog("[kindling] exit 0\n"), true);
  assert.equal(sessionExitLineInLog("still running"), false);
});

test("notifyPostSucceeded detects slack API and agent prose", () => {
  assert.equal(
    notifyPostSucceeded('posted method chat.postMessage result: {"ok": true, "ts": "1234.56"}'),
    true,
  );
  assert.equal(notifyPostSucceeded("Posted to #get-dx-insights-test successfully"), true);
  assert.equal(notifyPostSucceeded("waiting for approval"), false);
});

test("evaluateLongSessionPoll completes notify on keyword success after settle", () => {
  const snap = {
    log: 'posted method chat.postMessage result: {"ok": true, "channel": "C1", "ts": "1.2"}',
    exitCode: null,
    startedAt: Date.now() - 5000,
    mtimeMs: Date.now() - 1000,
  };
  const verdict = evaluateLongSessionPoll(snap, {
    columnId: "send-slack",
    hasSlackMessage: true,
    notifyMcpSeenAt: Date.now() - NOTIFY_MCP_SETTLE_MS - 1_000,
  });
  assert.equal(verdict.done, true);
  assert.equal(verdict.ok, true);
});

test("evaluateLongSessionPoll waits notify settle before keyword harvest", () => {
  const snap = {
    log: 'posted method chat.postMessage result: {"ok": true, "channel": "C1", "ts": "1.2"}',
    exitCode: null,
    startedAt: Date.now() - 5000,
    mtimeMs: Date.now() - 1000,
  };
  const verdict = evaluateLongSessionPoll(snap, {
    columnId: "send-slack",
    hasSlackMessage: true,
    notifyMcpSeenAt: Date.now(),
  });
  assert.equal(verdict.done, false);
  assert.equal(verdict.ok, true);
});

test("evaluateLongSessionPoll does not idle-complete notify without MCP keywords", () => {
  const now = Date.now();
  const snap = {
    log: "[kindling] interactive stage\nsome agent output",
    exitCode: null,
    startedAt: now - 30_000,
    mtimeMs: now - 20_000,
  };
  const verdict = evaluateLongSessionPoll(snap, { columnId: "send-slack", hasSlackMessage: true });
  assert.equal(verdict.done, false);
});

test("evaluateLongSessionPoll idle-completes non-notify long sessions", () => {
  const now = Date.now();
  const filler = "x".repeat(180);
  const snap = {
    log: `[kindling] interactive stage\nsome agent output ${filler}`,
    exitCode: null,
    startedAt: now - 30_000,
    mtimeMs: now - 25_000,
  };
  const verdict = evaluateLongSessionPoll(snap, { columnId: "prep-agenda", hasSlackMessage: false });
  assert.equal(verdict.done, true);
  assert.equal(verdict.ok, true);
});

test("evaluateLongSessionPoll keeps polling young sessions", () => {
  const snap = {
    log: "[kindling] starting",
    exitCode: null,
    startedAt: Date.now(),
    mtimeMs: Date.now(),
  };
  const verdict = evaluateLongSessionPoll(snap, { columnId: "send-slack", hasSlackMessage: true });
  assert.equal(verdict.done, false);
});

test("formatKindlingTerminalTitle prefixes stage label", () => {
  assert.equal(formatKindlingTerminalTitle("Notify"), "Kindling — Notify");
});

test("sanitizeTerminalScriptName strips unsafe path characters", () => {
  assert.equal(sanitizeTerminalScriptName("Kindling — Notify"), "Kindling — Notify");
  assert.equal(sanitizeTerminalScriptName("bad/name\\here"), "bad-name-here");
  assert.equal(sanitizeTerminalScriptName("   "), "run");
});

test("bashSetTerminalTitle emits terminal title escape", () => {
  assert.match(bashSetTerminalTitle("Kindling — Notify"), /printf '\\033\]0;%s\\007'/);
  assert.match(bashSetTerminalTitle("Kindling — Notify"), /'Kindling — Notify'/);
});

test("notifyMcpSettleMs reads PIT_NOTIFY_MCP_SETTLE_MS", () => {
  const prev = process.env.PIT_NOTIFY_MCP_SETTLE_MS;
  try {
    delete process.env.PIT_NOTIFY_MCP_SETTLE_MS;
    assert.equal(notifyMcpSettleMs(), NOTIFY_MCP_SETTLE_MS);
    process.env.PIT_NOTIFY_MCP_SETTLE_MS = "5000";
    assert.equal(notifyMcpSettleMs(), 5000);
    process.env.PIT_NOTIFY_MCP_SETTLE_MS = "nope";
    assert.equal(notifyMcpSettleMs(), NOTIFY_MCP_SETTLE_MS);
  } finally {
    if (prev === undefined) delete process.env.PIT_NOTIFY_MCP_SETTLE_MS;
    else process.env.PIT_NOTIFY_MCP_SETTLE_MS = prev;
  }
});

test("ensureNotifyMcpSeenAt records first seen timestamp in session dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kindling-notify-seen-"));
  try {
    const first = await ensureNotifyMcpSeenAt(dir);
    const second = await ensureNotifyMcpSeenAt(dir);
    assert.equal(second, first);
    assert.ok(first > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
