import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContext, harvestVars, interpolate, mentionedKeys, outputVarName } from "./flow-context.ts";
import type { Ticket, WorkflowColumn } from "./types.ts";

const col: WorkflowColumn = {
  id: "synthesize",
  name: "Synthesize",
  label: "Spec",
  role: "prompt",
  rail: "run",
  enabled: true,
  outputKey: "spec",
};

const ticket: Ticket = {
  id: "t1",
  key: "X2-1",
  title: "Prompts in Jira",
  description: "Show the live prompt.",
  labels: ["discovery"],
  columnId: "synthesize",
  flowId: "flow-discovery",
  status: "idle",
  spend: 0,
  runId: "r1",
  slackChannel: "dx",
  slackChannelId: "C1",
  slackMembers: "@maya",
  ideationNotes: "Use #dx",
  transcript: "Maya: pin the prompt.",
  outputs: { ideation: "Slack channel: #dx" },
  vars: { brief: "Slack channel: #dx" },
  agentResponses: [],
  grillRounds: [],
  fryComplete: false,
  plan: null,
  jiraCreated: [],
  createdAt: "2026-08-28T00:00:00.000Z",
};

test("interpolate fills ticket and stage vars", () => {
  const ctx = buildContext(ticket);
  const out = interpolate("{{ticket.key}} :: {{brief}}\n{{transcript}}", ctx);
  assert.match(out, /X2-1/);
  assert.match(out, /#dx/);
  assert.match(out, /pin the prompt/);
});

test("missing vars become empty string, not the token", () => {
  assert.equal(interpolate("A {{missing}} Z", {}), "A  Z");
});

test("harvestVars publishes outputKey, column id, and prev", () => {
  const vars = harvestVars(ticket, col, "The spec body");
  assert.equal(vars.spec, "The spec body");
  assert.equal(vars.synthesize, "The spec body");
  assert.equal(vars.prev, "The spec body");
});

test("mentionedKeys lists unique tokens", () => {
  assert.deepEqual(mentionedKeys("{{spec}} then {{spec}} and {{grill}}"), ["spec", "grill"]);
});

test("outputVarName prefers outputKey", () => {
  assert.equal(outputVarName(col), "spec");
  assert.equal(outputVarName({ ...col, outputKey: "" }), "synthesize");
});
