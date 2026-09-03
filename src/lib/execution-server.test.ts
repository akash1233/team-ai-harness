import assert from "node:assert/strict";
import { test } from "node:test";
import { isGrokAgentPath, resolveExecution } from "./execution.server.ts";

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

test("resolveExecution defaults stageTimeoutMs to 5 minutes", () => {
  withEnv("PIT_STAGE_TIMEOUT_MS", undefined, () => {
    assert.equal(resolveExecution().stageTimeoutMs, 300000);
  });
});

test("resolveExecution reads PIT_STAGE_TIMEOUT_MS", () => {
  withEnv("PIT_STAGE_TIMEOUT_MS", "600000", () => {
    assert.equal(resolveExecution().stageTimeoutMs, 600000);
  });
});

test("resolveExecution keeps client stageTimeoutMs when env is unset", () => {
  withEnv("PIT_STAGE_TIMEOUT_MS", undefined, () => {
    const exec = resolveExecution({ ...resolveExecution(), stageTimeoutMs: 420000 });
    assert.equal(exec.stageTimeoutMs, 420000);
  });
});

test("resolveExecution accepts PIT_DEFAULT_AGENT=webllm and profile", () => {
  withEnv("PIT_DEFAULT_AGENT", "webllm", () => {
    withEnv("PIT_WEBLLM_PROFILE", "fast", () => {
      const exec = resolveExecution();
      assert.equal(exec.defaultAgent, "webllm");
      assert.equal(exec.webllmProfile, "fast");
    });
  });
});

test("Grok agent paths are never treated as Cursor", () => {
  assert.equal(isGrokAgentPath("/Users/me/.grok/bin/agent"), true);
  assert.equal(isGrokAgentPath("/Users/me/.grok/downloads/grok-macos-aarch64"), true);
  assert.equal(isGrokAgentPath("/Users/me/.local/bin/cursor-agent"), false);
});

test("classifyCliIdentity tells Cursor from Grok", async () => {
  const { classifyCliIdentity } = await import("./execution.server.ts");
  assert.equal(classifyCliIdentity("/Users/me/.grok/bin/agent", "grok 1.0.13"), "grok");
  assert.equal(classifyCliIdentity("/Users/me/.local/bin/cursor-agent", "2026.08.31-4057e58"), "cursor");
  assert.equal(classifyCliIdentity("/Users/me/.grok/downloads/grok-macos-aarch64", "grok 1.0.13"), "grok");
  assert.equal(classifyCliIdentity(null, ""), "missing");
});

test("inspectCliBins reports Cursor separately from Grok agent on PATH", async () => {
  const { inspectCliBins } = await import("./execution.server.ts");
  const report = await inspectCliBins();
  if (report.cursor.path) {
    assert.equal(report.cursor.identity, "cursor");
    assert.match(report.cursor.path, /cursor-agent/);
    assert.doesNotMatch(report.cursor.realPath ?? report.cursor.path, /\.grok\//);
  }
  if (report.grokOnPath) {
    assert.equal(report.grokOnPath.identity, "grok");
    assert.match(report.grokOnPath.realPath ?? report.grokOnPath.path ?? "", /grok/i);
  }
});

test("stage timeout is independent from the notify settle delay", () => {
  withEnv("PIT_STAGE_TIMEOUT_MS", "300000", () => {
    withEnv("PIT_NOTIFY_MCP_SETTLE_MS", "10000", () => {
      const exec = resolveExecution();
      assert.equal(exec.stageTimeoutMs, 300000);
      assert.equal(exec.timeoutMs, 120000);
    });
  });
});
