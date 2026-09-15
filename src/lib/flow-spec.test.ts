import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKED_COLUMN_ID, COLUMNS, QUICK_SPEC_COLUMNS, columnsFromFlowSpec } from "./columns.ts";
import {
  clearFlowSpecCache,
  discoveryFlowPath,
  flowStageAgent,
  flowStageMentionedKeys,
  flowStageWebllmProfile,
  getFlowStage,
  listFlowVariables,
  loadDiscoveryFlowSpec,
  loadQuickSpecFlowSpec,
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
  fryRounds: [],
  fryComplete: false,
  plan: null,
  jiraCreated: [],
  createdAt: "2026-08-28T00:00:00.000Z",
  linkedJiras: [],
};

test("Quick spec JSON is transcript through Done and is the default flow", async () => {
  const flow = loadQuickSpecFlowSpec();
  assert.equal(flow.id, "flow-quick-spec");
  assert.deepEqual(
    flow.stages.map((s) => s.id),
    [
      "transcript",
      "synthesize",
      "preview-synthesize",
      "fryme",
      "preview-fryme",
      "write-plan",
      "approve",
      "file-jira",
      "done",
    ],
  );
  assert.deepEqual(
    QUICK_SPEC_COLUMNS.map((c) => c.id),
    flow.stages.map((s) => s.id),
  );
  for (const stage of flow.stages) {
    assert.deepEqual(validateStagePrompt(stage, flow), [], `unknown tokens in ${stage.id}`);
  }
  const { createDefaultTeam } = await import("./team-config.ts");
  const team = createDefaultTeam();
  assert.equal(team.activeFlowId, "flow-quick-spec");
  assert.equal(team.columns[0]?.id, "transcript");
  assert.equal(team.columns.some((c) => c.id === "prep-agenda"), false);
});

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
  assert.ok(vars["approved-agenda"]);
  assert.ok(vars.fryme);
  assert.ok(vars["fryme.qa"]);
  assert.ok(vars["fryme.conclusions"]);
});

test("review stages write the approved previous output and have no agent prompt", () => {
  const agendaReview = getFlowStage("preview-agenda");
  const specReview = getFlowStage("preview-synthesize");
  const fryReview = getFlowStage("preview-fryme");
  assert.equal(agendaReview?.role, "review");
  assert.deepEqual(agendaReview?.writes, ["approved-agenda", "prev"]);
  assert.equal(agendaReview?.prompt, undefined);
  assert.equal(specReview?.role, "review");
  assert.deepEqual(specReview?.writes, ["spec", "prev"]);
  assert.equal(fryReview?.role, "review");
  assert.deepEqual(fryReview?.writes, ["fryme", "prev"]);
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

test("File Jira prompt sends the signed-off plan to jira-ghe on Cursor", () => {
  const prompt = resolveFlowStagePrompt("file-jira", {
    ...baseTicket,
    plan: {
      summary: "Pin prompts.",
      findings: [],
      scope: [],
      outOfScope: [],
      risks: [],
      steps: [{ title: "Epic: Prompt registry", detail: "Store versions.", references: [] }],
    },
  });
  assert.ok(prompt);
  assert.match(prompt!.system, /jira-ghe createNewJiraTicket/);
  assert.match(prompt!.user, /projectKey: X2/);
  assert.match(prompt!.user, /Epic: Prompt registry/);
  assert.match(prompt!.user, /createNewJiraTicket/);
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

test("Discovery flow pins Agenda and Spec to Cursor print; Notify stays Cursor TUI", () => {
  assert.equal(flowStageAgent("prep-agenda"), "cursor");
  assert.equal(flowStageWebllmProfile("prep-agenda"), undefined);
  assert.equal(flowStageAgent("synthesize"), "cursor");
  assert.equal(flowStageWebllmProfile("synthesize"), undefined);
  assert.equal(flowStageAgent("send-slack"), "cursor");
  assert.equal(flowStageWebllmProfile("send-slack"), undefined);
  assert.equal(flowStageAgent("file-jira"), "cursor");
  assert.equal(flowStageWebllmProfile("file-jira"), undefined);
});

test("Discovery Cursor/Claude stages declare print vs TUI", () => {
  assert.equal(getFlowStage("send-slack")?.cli, "tui");
  assert.equal(getFlowStage("file-jira")?.cli, "tui");
  assert.equal(getFlowStage("file-jira")?.agent, "cursor");
  assert.match(getFlowStage("file-jira")?.prompt?.system ?? "", /jira-ghe createNewJiraTicket/);
  assert.match(getFlowStage("file-jira")?.prompt?.user ?? "", /\{\{plan\}\}/);
  assert.match(getFlowStage("file-jira")?.prompt?.user ?? "", /\{\{jiraProject\}\}/);
  assert.equal(getFlowStage("write-plan")?.cli, "print");
  assert.equal(getFlowStage("fryme")?.cli, "print");
  assert.equal(getFlowStage("fryme")?.maxTokens, 2000);
  assert.match(getFlowStage("fryme")?.prompt?.system ?? "", /Return ONLY a JSON object/);
  assert.match(getFlowStage("fryme")?.prompt?.user ?? "", /\{\{spec\}\}/);
  assert.match(getFlowStage("fryme")?.prompt?.user ?? "", /\{\{fryme\}\}/);
  assert.match(getFlowStage("write-plan")?.prompt?.user ?? "", /\{\{spec\}\}/);
  assert.match(getFlowStage("write-plan")?.prompt?.user ?? "", /\{\{fryme\}\}/);
  assert.equal(getFlowStage("fry")?.id, "fryme");
  assert.equal(getFlowStage("preview-fry")?.id, "preview-fryme");
  assert.equal(getFlowStage("prep-agenda")?.cli, "print");
  assert.equal(getFlowStage("synthesize")?.cli, "print");
});

test("board columns match discovery.flow.json stages and omit Blocked", () => {
  const flow = loadDiscoveryFlowSpec();
  const columns = columnsFromFlowSpec(flow);
  assert.deepEqual(
    columns.map((c) => c.id),
    flow.stages.map((s) => s.id),
  );
  assert.ok(columns.some((c) => c.id === "done"));
  assert.equal(
    columns.some((c) => c.id === BLOCKED_COLUMN_ID),
    false,
  );
  assert.deepEqual(
    COLUMNS.map((c) => c.id),
    flow.stages.map((s) => s.id),
  );
  assert.equal(
    columns.every((c) => !c.locked),
    true,
  );
});

test("Fry Me prompt feeds the spec, prior answers, and the Fry Me skill", () => {
  const prompt = resolveFlowStagePrompt(
    "fryme",
    {
      ...baseTicket,
      vars: { spec: "Pinned prompt registry spec", fryme: "Round 1 already answered" },
      outputs: { synthesize: "Pinned prompt registry spec" },
    },
    [{ id: "doc-fry-me", title: "Fry Me skill", kind: "skill", body: "You are Fry Me.\n\nProblem Statement & Scope: ..." }],
  );
  assert.ok(prompt);
  assert.match(prompt!.system, /Problem Statement & Scope/);
  assert.match(prompt!.system, /Return ONLY a JSON object/);
  assert.match(prompt!.user, /Pinned prompt registry spec/);
  assert.match(prompt!.user, /Round 1 already answered/);
  assert.match(prompt!.user, /Start round 1|The team answered the last round/);
});

test("Plan Write Up interpolates spec plus every Fry Me question and answer", () => {
  const prompt = resolveFlowStagePrompt("write-plan", {
    ...baseTicket,
    fryComplete: true,
    outputs: { synthesize: "Pinned prompt registry spec", fryme: "Honor the pin." },
    vars: { spec: "Pinned prompt registry spec" },
    fryRounds: [
      {
        id: "r1",
        submitted: true,
        questions: [
          {
            n: 1,
            question: "Where do prompts live?",
            recommended: "Registry",
            answer: "Registry keyed by column",
            source: "spec",
          },
        ],
      },
    ],
  });
  assert.ok(prompt);
  assert.match(prompt!.user, /Pinned prompt registry spec/);
  assert.match(prompt!.user, /Where do prompts live/);
  assert.match(prompt!.user, /Registry keyed by column/);
  assert.match(prompt!.user, /binding decisions/);
});

test("legacy fry stage id still resolves the Fry Me prompt", () => {
  const fromNew = resolveFlowStagePrompt("fryme", baseTicket);
  const fromLegacy = resolveFlowStagePrompt("fry", baseTicket);
  assert.ok(fromNew);
  assert.equal(fromLegacy?.user, fromNew?.user);
  assert.equal(fromLegacy?.system, fromNew?.system);
});

test("Spec prompt interpolates conversation and attached Jira from the flow JSON", () => {
  const prompt = resolveFlowStagePrompt("synthesize", {
    ...baseTicket,
    transcript: "Maya: ship voice on Grill first.",
    linkedJiras: [{ key: "X2-1", title: "Voice", description: "Mic", status: "Open", url: "" }],
  });
  assert.ok(prompt);
  assert.match(prompt!.user, /Conversation:/);
  assert.match(prompt!.user, /ship voice on Grill first/);
  assert.match(prompt!.user, /X2-1 Voice/);
});

test("session promptTemplate is used for later runs until boot reloads JSON", () => {
  const fromJson = resolveFlowStagePrompt("prep-agenda", baseTicket);
  const matching = resolveFlowStagePrompt("prep-agenda", baseTicket, undefined, {
    promptTemplate: getFlowStage("prep-agenda")?.prompt
      ? [getFlowStage("prep-agenda")!.prompt!.system, getFlowStage("prep-agenda")!.prompt!.user]
          .filter((part) => part?.trim())
          .join("\n\n")
      : "",
  });
  const edited = resolveFlowStagePrompt("prep-agenda", baseTicket, undefined, {
    promptTemplate: "Session agenda for {{brief}} only.",
  });
  const custom = resolveFlowStagePrompt("custom-stage", baseTicket, undefined, {
    promptTemplate: "Echo {{brief}}",
  });
  assert.equal(matching?.user, fromJson?.user);
  assert.equal(matching?.system, fromJson?.system);
  assert.match(edited!.user, /Session agenda for/);
  assert.match(edited!.user, /Slack channel: #dx/);
  assert.doesNotMatch(edited!.user, /Write the agenda now/);
  assert.equal(custom?.user, "Echo Slack channel: #dx\nChannel ID: C1");
});
