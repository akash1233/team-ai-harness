import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearFlowSpecCache,
  discoveryFlowPath,
  flowStageAgent,
  flowStageMentionedKeys,
  flowStageWebllmProfile,
  getFlowStage,
  listFlowVariables,
  loadDiscoveryFlowSpec,
  resolveFlowStagePrompt,
  validateStagePrompt,
} from "./flow-spec.ts";
import type { Ticket } from "./types.ts";

const baseTicket: Ticket = {
  id: "t1",
  key: "X2-1",
  title: "Sample",
  description: "Should not appear in agenda unless prompt names ticket.description",
  labels: ["discovery"],
  columnId: "prep-agenda",
  flowId: "flow-discovery",
  status: "idle",
  spend: 0,
  runId: "r1",
  slackChannel: "dx",
  slackChannelId: "C1",
  slackMembers: "@maya",
  ideationNotes: "Meet in #dx",
  transcript: "",
  outputs: {},
  vars: {
    brief: "Slack channel: #dx\nChannel ID: C1",
    agenda: "",
  },
  agentResponses: [],
  grillRounds: [],
  fryComplete: false,
  plan: null,
  jiraCreated: [],
  createdAt: "2026-08-28T00:00:00.000Z",
  linkedJiras: [],
};

test("discovery flow JSON loads from flows/discovery.flow.json", () => {
  clearFlowSpecCache();
  const flow = loadDiscoveryFlowSpec();
  assert.equal(flow.id, "flow-discovery");
  assert.ok(flow.stages.some((s) => s.id === "prep-agenda"));
  assert.match(discoveryFlowPath(), /discovery\.flow\.json$/);
});

test("listFlowVariables documents the system catalog", () => {
  const vars = listFlowVariables();
  assert.ok(vars.brief);
  assert.ok(vars.jira);
  assert.ok(vars.slackMessage);
});

test("Agenda prompt contains brief and all linked Jiras only", () => {
  const issues = [
    { key: "X2-123", title: "First epic", description: "First body", status: "Open", url: "" },
    { key: "X2-456", title: "Second epic", description: "Second body", status: "Open", url: "" },
  ];
  const prompt = resolveFlowStagePrompt("prep-agenda", {
    ...baseTicket,
    linkedJiras: issues,
  });
  assert.ok(prompt);
  assert.match(prompt!.user, /Brief \(logistics\)/);
  assert.match(prompt!.user, /Slack channel: #dx/);
  assert.match(prompt!.user, /X2-123 First epic[\s\S]*First body/);
  assert.match(prompt!.user, /X2-456 Second epic[\s\S]*Second body/);
  assert.doesNotMatch(prompt!.user, /Should not appear in agenda/);
  assert.doesNotMatch(prompt!.user, /Upstream outputs/);
});

test("Notify prompt contains slack channel and composed message with agenda", () => {
  const prompt = resolveFlowStagePrompt("send-slack", {
    ...baseTicket,
    vars: {
      ...baseTicket.vars,
      agenda: "Six-section agenda body",
      slackMessage: "Team discussion agenda\n\nSix-section agenda body",
    },
    linkedJiras: [{ key: "X2-7", title: "Epic", description: "", status: "", url: "" }],
  });
  assert.ok(prompt);
  assert.match(prompt!.user, /Channel ID: C1/);
  assert.match(prompt!.user, /#dx/);
  assert.match(prompt!.user, /Six-section agenda body/);
});

test("stage prompts only reference catalog tokens (except per-key jira.*)", () => {
  const flow = loadDiscoveryFlowSpec();
  for (const stage of flow.stages) {
    const unknown = validateStagePrompt(stage, flow);
    assert.deepEqual(unknown, [], `unknown tokens in ${stage.id}: ${unknown.join(", ")}`);
  }
});

test("flowStageMentionedKeys lists tokens from JSON prompt", () => {
  const stage = getFlowStage("prep-agenda");
  const keys = flowStageMentionedKeys(stage);
  assert.ok(keys.includes("brief"));
  assert.ok(keys.includes("jira"));
});

test("Discovery flow pins Agenda and Spec to WebLLM; Notify stays Cursor", () => {
  assert.equal(flowStageAgent("prep-agenda"), "webllm");
  assert.equal(flowStageWebllmProfile("prep-agenda"), "fast");
  assert.equal(flowStageAgent("synthesize"), "webllm");
  assert.equal(flowStageWebllmProfile("synthesize"), "quality");
  assert.equal(flowStageAgent("send-slack"), "cursor");
  assert.equal(flowStageWebllmProfile("send-slack"), undefined);
});

test("Spec prompt is a short in-browser synthesis, not a repo-explore skill", () => {
  const prompt = resolveFlowStagePrompt("synthesize", {
    ...baseTicket,
    transcript: "Maya: ship voice on Grill first.",
  });
  assert.ok(prompt);
  assert.match(prompt!.user, /Notes:/);
  assert.match(prompt!.user, /ship voice on Grill first/);
  assert.match(prompt!.system, /Spec document only/);
  assert.doesNotMatch(prompt!.system, /explore the repo/i);
  assert.doesNotMatch(prompt!.system, /setup-matt-pocock/);
});
