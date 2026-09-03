import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS } from "./columns.ts";
import { buildContext, buildUpstream, harvestBriefVars, harvestNotifyVars, harvestReviewVars, harvestVars, interpolate, mentionedKeys, outputVarName, reviewSourceText, syncNotifyPreviewVars } from "./flow-context.ts";
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
  linkedJiras: [],
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

test("reviewSourceText reads the previous stage output", () => {
  const review = COLUMNS.find((c) => c.id === "preview-agenda")!;
  const text = reviewSourceText(
    { ...ticket, columnId: "preview-agenda", vars: { agenda: "Six-section agenda" }, outputs: { "prep-agenda": "Six-section agenda" } },
    review,
    COLUMNS,
  );
  assert.equal(text, "Six-section agenda");
});

test("harvestReviewVars writes approved key and updates the source variable", () => {
  const review = COLUMNS.find((c) => c.id === "preview-agenda")!;
  const source = COLUMNS.find((c) => c.id === "prep-agenda")!;
  const vars = harvestReviewVars(
    { ...ticket, vars: { agenda: "Original agenda" } },
    review,
    source,
    "Edited agenda",
  );
  assert.equal(vars["approved-agenda"], "Edited agenda");
  assert.equal(vars.agenda, "Edited agenda");
  assert.equal(vars.prev, "Edited agenda");
});

test("mentionedKeys lists unique tokens", () => {
  assert.deepEqual(mentionedKeys("{{spec}} then {{spec}} and {{grill}}"), ["spec", "grill"]);
});

test("outputVarName prefers outputKey", () => {
  assert.equal(outputVarName(col), "spec");
  assert.equal(outputVarName({ ...col, outputKey: "" }), "synthesize");
});

test("buildContext exposes slack notify tokens", () => {
  const ctx = buildContext({
    ...ticket,
    vars: { agenda: "Six-section agenda" },
    linkedJiras: [{ key: "X2-7", title: "Epic", description: "", status: "", url: "" }],
  });
  assert.equal(ctx.slackChannel, "dx");
  assert.equal(ctx.slackChannelId, "C1");
  assert.equal(ctx.agenda, "Six-section agenda");
  assert.match(ctx.slackMessage, /Six-section agenda/);
  assert.match(ctx.slackMessage, /X2-7/);
});

test("buildContext exposes aggregate, first, and per-key Jira tokens", () => {
  const issues = [
    { key: "X2-123", title: "First", status: "Open", url: "https://jira/X2-123", description: "First body" },
    { key: "X2-456", title: "Second", status: "Done", url: "https://jira/X2-456", description: "Second body" },
  ];
  const ctx = buildContext({ ...ticket, linkedJiras: issues });
  assert.match(ctx.jira, /X2-123 First[\s\S]*X2-456 Second/);
  assert.equal(ctx["jira.key"], "X2-123");
  assert.equal(ctx["jira.X2-456.description"], "Second body");
  assert.match(ctx["jira.X2-123"], /First body/);
});

test("buildContext keeps named variables authoritative and de-duplicates context", () => {
  const ctx = buildContext({
    ...ticket,
    transcript: "raw transcript",
    outputs: { ideation: "same brief" },
    vars: { brief: "same brief", prev: "same brief", transcript: "edited transcript" },
    linkedJiras: [
      { key: "X2-123", title: "First", status: "Open", url: "https://jira/X2-123", description: "First body" },
    ],
  });
  assert.equal(ctx.transcript, "edited transcript");
  assert.equal(ctx.context.match(/same brief/g)?.length, 1);
  assert.match(ctx.context, /## jira\nX2-123 First/);
  assert.doesNotMatch(ctx.context, /## jira\.X2-123/);
});

test("harvestBriefVars publishes brief and slack tokens", () => {
  const vars = harvestBriefVars(
    { ...ticket, slackChannel: "dx", slackChannelId: "C9", slackMembers: "@maya" },
    "Slack channel: #dx\nChannel ID: C9",
  );
  assert.equal(vars.brief, "Slack channel: #dx\nChannel ID: C9");
  assert.equal(vars.slackChannel, "dx");
  assert.equal(vars.slackChannelId, "C9");
  assert.equal(vars["slack.members"], "@maya");
  const ctx = buildContext({ ...ticket, vars });
  assert.equal(ctx.slackChannel, "dx");
  assert.equal(ctx.slackChannelId, "C9");
});

test("syncNotifyPreviewVars composes slackMessage from agenda", () => {
  const vars = syncNotifyPreviewVars({
    ...ticket,
    vars: { agenda: "Six-section agenda", brief: "Slack channel: #dx", slackChannel: "dx", slackChannelId: "C1" },
    linkedJiras: [{ key: "X2-7", title: "Epic", description: "", status: "", url: "" }],
  });
  assert.equal(vars.agenda, "Six-section agenda");
  assert.match(vars.slackMessage ?? "", /Six-section agenda/);
  assert.match(vars.slackMessage ?? "", /X2-7/);
});

test("harvestNotifyVars records slack post metadata", () => {
  const col = { id: "send-slack", name: "Notify", label: "Notify", role: "prompt" as const, rail: "run" as const, enabled: true, outputKey: "slack_post" };
  const vars = harvestNotifyVars(
    ticket,
    col,
    { channel: "dx", channelId: "C1", ts: "123.456" },
    "Team discussion agenda\n\n## Section 1",
  );
  assert.match(vars.slack_post ?? "", /Posted to #dx/);
  assert.equal(vars["slack.ts"], "123.456");
  assert.equal(vars.slackMessage, "Team discussion agenda\n\n## Section 1");
});

test("buildUpstream retains all prior outputs when an intermediate stage is disabled", () => {
  const columns: WorkflowColumn[] = [
    { id: "capture", name: "Capture", label: "Brief", role: "collect-input", rail: "run", enabled: true, outputKey: "brief" },
    { id: "skip", name: "Skipped", label: "Skipped", role: "prompt", rail: "run", enabled: false, outputKey: "spec" },
    { id: "final", name: "Final", label: "Final", role: "prompt", rail: "run", enabled: true, outputKey: "result" },
  ];
  const upstream = buildUpstream(
    { ...ticket, columnId: "final", outputs: { capture: "captured data" }, vars: { brief: "captured data", custom: "custom value" } },
    columns,
    "final",
  );
  assert.match(upstream, /## Brief \(\{\{brief\}\}\)\ncaptured data/);
  assert.match(upstream, /## Variable \{\{custom\}\}\ncustom value/);
  assert.equal(upstream.match(/captured data/g)?.length, 1);
});
