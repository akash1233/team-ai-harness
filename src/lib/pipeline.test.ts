import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, PREP_AGENDA_COLUMN_ID, SYNTHESIZE_COLUMN_ID, WRITE_PLAN_COLUMN_ID, startColumnId } from "./columns.ts";
import { buildContext, harvestVars, interpolate, outputVarName } from "./flow-context.ts";
import type { Ticket } from "./types.ts";

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    key: "X2-1",
    title: "Voice on the board",
    description: "Operators want to speak Grill answers.",
    labels: ["discovery"],
    columnId: "ideation",
    flowId: "flow-discovery",
    status: "idle",
    spend: 0,
    runId: "r1",
    ownerId: "m-maya",
    createdAt: new Date().toISOString(),
    slackChannel: "dx",
    slackChannelId: "",
    slackMembers: "@maya",
    ideationNotes: "Need a mic on Grill.",
    transcript: "Maya: ship voice on Grill first.",
    outputs: {},
    vars: {},
    agentResponses: [],
    grillRounds: [],
    fryComplete: false,
    plan: null,
    jiraCreated: [],
    ...over,
  };
}

test("Discovery agents: agenda Cursor, spec Studio, plan Cursor", () => {
  const agenda = COLUMNS.find((c) => c.id === PREP_AGENDA_COLUMN_ID);
  const spec = COLUMNS.find((c) => c.id === SYNTHESIZE_COLUMN_ID);
  const plan = COLUMNS.find((c) => c.id === WRITE_PLAN_COLUMN_ID);
  assert.equal(agenda?.agent, "cursor");
  assert.equal(spec?.agent, "studio");
  assert.equal(plan?.agent, "cursor");
});

test("brief harvested from ideation becomes {{brief}} for Agenda (Cursor)", () => {
  const col = COLUMNS.find((c) => c.id === "ideation")!;
  const brief = "Slack channel: #dx\nNotify: @maya";
  const t = ticket({ vars: harvestVars(ticket(), col, brief) });
  assert.equal(t.vars.brief, brief);
  const agenda = COLUMNS.find((c) => c.id === PREP_AGENDA_COLUMN_ID)!;
  const ctx = buildContext(t);
  const user = interpolate("Brief:\n{{brief}}\nWrite the agenda now.", ctx);
  assert.match(user, /Slack channel: #dx/);
  assert.equal(outputVarName(agenda), "agenda");
});

test("spec (Studio) prompt reads brief + transcript from prior stages", () => {
  let t = ticket();
  t = { ...t, vars: harvestVars(t, COLUMNS.find((c) => c.id === "ideation")!, "channel #dx") };
  t = { ...t, vars: harvestVars(t, COLUMNS.find((c) => c.id === "transcript")!, t.transcript) };
  const spec = COLUMNS.find((c) => c.id === SYNTHESIZE_COLUMN_ID)!;
  const filled = interpolate(spec.promptTemplate || "", buildContext(t));
  assert.match(filled, /channel #dx/);
  assert.match(filled, /ship voice on Grill first/);
});

test("tickets start on first agent stage if there is no collect-input", () => {
  const cols = [
    { id: "test", name: "Test", label: "Test", role: "prompt" as const, rail: "run" as const, enabled: true },
    { id: "agenda", name: "Agenda", label: "Agenda", role: "prompt" as const, rail: "run" as const, enabled: true },
  ];
  assert.equal(startColumnId(cols), "test");
});
