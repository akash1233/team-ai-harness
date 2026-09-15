import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS } from "./columns.ts";
import { buildContext } from "./flow-context.ts";
import { applyStageTestVars, isStageTestable, seedStageTestValues, stageTestInputKeys } from "./stage-test.ts";
import type { Ticket } from "./types.ts";

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    key: "X2-1",
    title: "Voice on the board",
    description: "Operators want to speak Grill answers.",
    labels: ["discovery"],
    columnId: "synthesize",
    flowId: "flow-discovery",
    status: "idle",
    spend: 0,
    runId: "r1",
    slackChannel: "dx",
    slackChannelId: "C1",
    slackMembers: "@maya",
    ideationNotes: "Need a mic on Grill.",
    transcript: "Maya: ship voice on Grill first.",
    outputs: { ideation: "Slack channel: #dx", transcript: "Maya: ship voice on Grill first." },
    vars: { brief: "Slack channel: #dx", transcript: "Maya: ship voice on Grill first." },
    agentResponses: [],
    fryRounds: [],
    fryComplete: false,
    plan: null,
    jiraCreated: [],
    createdAt: new Date().toISOString(),
    linkedJiras: [],
    ...over,
  };
}

test("isStageTestable is false only for terminal stages", () => {
  const spec = COLUMNS.find((c) => c.id === "synthesize")!;
  const done = COLUMNS.find((c) => c.id === "done")!;
  assert.equal(isStageTestable(spec), true);
  assert.equal(isStageTestable(done), false);
});

test("stageTestInputKeys lists tokens the Spec prompt reads", () => {
  const spec = COLUMNS.find((c) => c.id === "synthesize")!;
  const keys = stageTestInputKeys(spec);
  assert.ok(keys.includes("transcript"));
  assert.ok(keys.includes("jira"));
  assert.equal(keys.includes("frymePhase"), false);
});

test("stageTestInputKeys lists File Jira plan and project tokens", () => {
  const fileJira = COLUMNS.find((c) => c.id === "file-jira")!;
  const keys = stageTestInputKeys(fileJira);
  assert.ok(keys.includes("plan"));
  assert.ok(keys.includes("jiraProject"));
});

test("seedStageTestValues copies last-stage vars, not empty overrides", () => {
  const spec = COLUMNS.find((c) => c.id === "synthesize")!;
  const seeded = seedStageTestValues(ticket(), stageTestInputKeys(spec));
  assert.match(seeded.transcript, /ship voice on Grill first/);
});

test("seedStageTestValues ignores existing stageTestVars overlays", () => {
  const spec = COLUMNS.find((c) => c.id === "synthesize")!;
  const seeded = seedStageTestValues(
    ticket({ stageTestVars: { transcript: "OVERRIDE" } }),
    ["transcript"],
  );
  assert.match(seeded.transcript, /ship voice on Grill first/);
  assert.doesNotMatch(seeded.transcript, /OVERRIDE/);
});

test("applyStageTestVars writes overrides onto vars and transcript", () => {
  const next = applyStageTestVars(ticket(), { transcript: "Priya: voice later." });
  assert.equal(next.transcript, "Priya: voice later.");
  assert.equal(next.vars.transcript, "Priya: voice later.");
});

test("applyStageTestVars parses plan JSON onto ticket.plan", () => {
  const plan = {
    summary: "Pin prompts.",
    findings: [],
    scope: [],
    outOfScope: [],
    risks: [],
    steps: [{ title: "Epic: Prompt registry", detail: "Store versions.", references: [] }],
  };
  const next = applyStageTestVars(ticket(), { plan: JSON.stringify(plan) });
  assert.equal(next.plan?.steps[0]?.title, "Epic: Prompt registry");
  assert.equal(next.vars.plan, JSON.stringify(plan));
});

test("buildContext prefers stageTestVars over harvested vars", () => {
  const ctx = buildContext(ticket({ stageTestVars: { transcript: "Jon: skip voice." } }));
  assert.equal(ctx.transcript, "Jon: skip voice.");
});

test("buildContext keeps stageTestVars.jira even when no issues are linked", () => {
  const ctx = buildContext(ticket({ stageTestVars: { jira: "X2-1 Voice on Grill" } }));
  assert.equal(ctx.jira, "X2-1 Voice on Grill");
});
