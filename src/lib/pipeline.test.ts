import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, PREP_AGENDA_COLUMN_ID, SYNTHESIZE_COLUMN_ID, WRITE_PLAN_COLUMN_ID, startColumnId } from "./columns.ts";
import { buildContext, harvestVars, interpolate, outputVarName } from "./flow-context.ts";
import { clearTicketHistory } from "./sample-data.ts";
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
    linkedJiras: [],
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

test("harvestVars stores only the stage text under the variable name", () => {
  const col = { id: "s1", name: "Draft", label: "Draft", role: "prompt" as const, rail: "run" as const, enabled: true, outputKey: "agenda" };
  const t = ticket();
  const vars = harvestVars(t, col, "  Meeting agenda\nItem 1  ");
  assert.equal(vars.agenda, "Meeting agenda\nItem 1");
  assert.equal(vars.prev, "Meeting agenda\nItem 1");
});

test("tickets start on first agent stage if there is no collect-input", () => {
  const cols = [
    { id: "test", name: "Test", label: "Test", role: "prompt" as const, rail: "run" as const, enabled: true },
    { id: "agenda", name: "Agenda", label: "Agenda", role: "prompt" as const, rail: "run" as const, enabled: true },
  ];
  assert.equal(startColumnId(cols), "test");
});

test("clearTicketHistory removes run data and parks the ticket at the flow start", () => {
  const cleared = clearTicketHistory(
    ticket({
      columnId: "fry",
      status: "blocked",
      spend: 2.5,
      slackMembers: "@maya",
      ideationNotes: "notes",
      transcript: "notes",
      slackPosted: { channel: "dx", channelId: "C1", ts: "1" },
      outputs: { synthesize: "spec" },
      vars: { spec: "spec" },
      agentResponses: [{ id: "a1", at: new Date().toISOString(), columnId: "synthesize", summary: "done", body: "spec" }],
      blockedReason: "failed",
    }),
    "ideation",
    { slackChannel: "team-channel", slackChannelId: "C99" },
  );
  assert.equal(cleared.columnId, "ideation");
  assert.equal(cleared.status, "idle");
  assert.equal(cleared.spend, 0);
  assert.equal(cleared.slackChannel, "team-channel");
  assert.equal(cleared.slackChannelId, "C99");
  assert.equal(cleared.slackMembers, "");
  assert.equal(cleared.ideationNotes, "");
  assert.equal(cleared.transcript, "");
  assert.equal(cleared.slackPosted, undefined);
  assert.deepEqual(cleared.outputs, {});
  assert.deepEqual(cleared.vars, {});
  assert.deepEqual(cleared.agentResponses, []);
  assert.equal(cleared.blockedReason, undefined);
});
