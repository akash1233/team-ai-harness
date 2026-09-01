import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveExecution } from "./execution.server.ts";

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

test("stage timeout is independent from the notify settle delay", () => {
  withEnv("PIT_STAGE_TIMEOUT_MS", "300000", () => {
    withEnv("PIT_NOTIFY_MCP_SETTLE_MS", "10000", () => {
      const exec = resolveExecution();
      assert.equal(exec.stageTimeoutMs, 300000);
      assert.equal(exec.timeoutMs, 120000);
    });
  });
});
