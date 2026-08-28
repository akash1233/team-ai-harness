import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStep, stepLabel, legacyDefaultAgent } from "./agents.ts";
import type { ExecutionConfig } from "./types.ts";

const exec: ExecutionConfig = {
  defaultAgent: "cursor",
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
  cisModel: "anthropic.claude-haiku-4-5-20251001-v1:0",
  cisTaskType: "aws-converse-v1",
  timeoutMs: 120000,
  demoFallbacks: true,
};

test("inherit uses workspace default Cursor local", () => {
  const step = resolveStep({ agent: "inherit" }, exec);
  assert.equal(step.kind, "cursor");
  assert.equal(step.target, "local");
  assert.equal(step.label, "Cursor local");
});

test("Fryme column can pin Claude even when default is Cursor", () => {
  const step = resolveStep({ agent: "claude" }, exec);
  assert.equal(step.kind, "claude");
  assert.equal(step.label, "Claude local");
});

test("Studio step ignores Cursor local/remote target", () => {
  const step = resolveStep({ agent: "studio" }, exec);
  assert.equal(step.kind, "studio");
  assert.equal(step.label, "GenAI Studio");
});

test("remote Cursor target surfaces in the label", () => {
  const step = resolveStep({ agent: "cursor" }, { ...exec, cursorTarget: "remote" });
  assert.equal(step.target, "remote");
  assert.equal(step.label, "Cursor remote");
});

test("legacy provider studio maps to defaultAgent studio", () => {
  assert.equal(legacyDefaultAgent({ provider: "studio" }), "studio");
  assert.equal(legacyDefaultAgent({ localAgent: "claude" }), "claude");
});

test("step labels stay short for the run button", () => {
  assert.equal(stepLabel("cis", "remote"), "CIS");
});
