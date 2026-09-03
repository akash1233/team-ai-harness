import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearLogBuffer,
  clip,
  createLogger,
  formatLogLine,
  getLogBuffer,
  getLogLevel,
  ingestLogLines,
  isLevelEnabled,
  parseLogLevel,
  redactFields,
  setLogLevel,
  startCall,
  subscribeLogs,
} from "./logger.ts";

test("parseLogLevel accepts silent through debug", () => {
  assert.equal(parseLogLevel("INFO"), "info");
  assert.equal(parseLogLevel(" debug "), "debug");
  assert.equal(parseLogLevel("nope"), null);
  assert.equal(parseLogLevel(""), null);
});

test("getLogLevel reads PIT_LOG_LEVEL from the environment", () => {
  setLogLevel(null);
  const prev = process.env.PIT_LOG_LEVEL;
  process.env.PIT_LOG_LEVEL = "debug";
  assert.equal(getLogLevel(), "debug");
  process.env.PIT_LOG_LEVEL = "silent";
  assert.equal(getLogLevel(), "silent");
  if (prev === undefined) delete process.env.PIT_LOG_LEVEL;
  else process.env.PIT_LOG_LEVEL = prev;
});

test("PIT_LOG_LEVEL gates debug vs info vs error", () => {
  setLogLevel("info");
  assert.equal(getLogLevel(), "info");
  assert.equal(isLevelEnabled("info"), true);
  assert.equal(isLevelEnabled("debug"), false);
  assert.equal(isLevelEnabled("error"), true);
  setLogLevel("debug");
  assert.equal(isLevelEnabled("debug"), true);
  assert.equal(isLevelEnabled("info"), true);
  assert.equal(isLevelEnabled("warn"), true);
  assert.equal(isLevelEnabled("error"), true);
  setLogLevel("error");
  assert.equal(isLevelEnabled("warn"), false);
  assert.equal(isLevelEnabled("error"), true);
  setLogLevel("silent");
  assert.equal(isLevelEnabled("error"), false);
  setLogLevel(null);
});

test("redactFields strips secrets and clips long strings", () => {
  const out = redactFields({
    featureKey: "user.id",
    jiraPat: "super-secret",
    token: "abc",
    kind: "cursor",
    prompt: "a".repeat(400),
  });
  assert.equal(out.featureKey, "[redacted]");
  assert.equal(out.jiraPat, "[redacted]");
  assert.equal(out.token, "[redacted]");
  assert.equal(out.kind, "cursor");
  assert.equal(typeof out.prompt, "string");
  assert.ok(String(out.prompt).endsWith("…"));
  assert.ok(String(out.prompt).length < 250);
  assert.equal(redactFields({ path: "/Users/me/.local/bin/cursor-agent" }).path, "/Users/me/.local/bin/cursor-agent");
});

test("formatLogLine is one grep-able kindling line", () => {
  const line = formatLogLine({
    ts: "2026-09-02T12:00:00.000Z",
    level: "info",
    scope: "exec",
    msg: "start",
    fields: { call: "abc123", kind: "cursor" },
  });
  assert.equal(
    line,
    "[kindling] 2026-09-02T12:00:00.000Z INFO  exec start call=abc123 kind=cursor",
  );
});

test("startCall writes start/ok/fail into the app log buffer", () => {
  setLogLevel("debug");
  clearLogBuffer();
  const orig = { info: console.info, warn: console.warn, error: console.error, debug: console.debug, log: console.log };
  Object.assign(console, { info() {}, warn() {}, error() {}, debug() {}, log() {} });
  try {
    const call = startCall("exec", { kind: "cursor" });
    call.log.debug("cli", { bin: "cursor-agent" });
    call.ok({ via: "Cursor" });
    const lines = getLogBuffer().map((r) => r.msg);
    assert.deepEqual(lines, ["start", "cli", "ok"]);
    assert.ok(getLogBuffer()[0]?.line.includes("kind=cursor"));
    assert.ok(getLogBuffer()[0]?.line.includes(`call=${call.id}`));

    clearLogBuffer();
    const failed = startCall("exec.http", { kind: "studio" });
    failed.fail("Studio 401");
    assert.equal(getLogBuffer().at(-1)?.level, "error");
    assert.match(getLogBuffer().at(-1)?.line ?? "", /\bfail\b/);
    assert.match(getLogBuffer().at(-1)?.line ?? "", /error="Studio 401"/);

    setLogLevel("info");
    clearLogBuffer();
    createLogger("exec").debug("hidden");
    assert.equal(getLogBuffer().length, 0);
  } finally {
    Object.assign(console, orig);
    setLogLevel(null);
  }
});

test("clip flattens whitespace", () => {
  assert.equal(clip("a\n\nb  c"), "a b c");
});

test("subscribeLogs and ingestLogLines feed the App log buffer", () => {
  setLogLevel("info");
  clearLogBuffer();
  const seen: string[] = [];
  const unsub = subscribeLogs((rec) => seen.push(rec.msg));
  createLogger("exec.webllm").info("load.start", { modelId: "Qwen3-8B" });
  unsub();
  ingestLogLines(["[kindling] client line"]);
  assert.equal(seen.includes("load.start"), true);
  assert.ok(getLogBuffer().some((r) => r.line.includes("client line")));
  setLogLevel(null);
});
