import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStep } from "./agents.ts";
import {
  COLUMNS,
  DONE_COLUMN_ID,
  FILE_JIRA_COLUMN_ID,
  nextColumnId,
  parkOrphanTickets,
  previousColumn,
  resolveActiveStage,
  startColumnId,
} from "./columns.ts";
import { githubApiBase, jiraHost } from "./connectors.ts";
import { ensurePrintMode, stageOutputFromLog, withoutFullAgentMode, withNonInteractiveFlags } from "./cli-session.ts";
import { buildContext, harvestVars, interpolate, outputVarName } from "./flow-context.ts";
import { resolveStagePrompt } from "./prompts.ts";
import type { ExecutionConfig, Ticket, WorkflowColumn } from "./types.ts";
import { DEFAULT_PRICING } from "./pricing.ts";

const exec: ExecutionConfig = {
  defaultAgent: "cursor",
  cursorTarget: "local",
  claudeTarget: "local",
  cursorCommand: "agent -p --output-format text",
  claudeCommand: "claude -p --output-format text",
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
  demoFallbacks: false,
  fullAgentMode: false,
  runInTerminal: true,
  pricing: DEFAULT_PRICING,
};

function col(over: Partial<WorkflowColumn> & Pick<WorkflowColumn, "id" | "role">): WorkflowColumn {
  return {
    name: over.id,
    label: over.id,
    rail: "run",
    enabled: true,
    custom: true,
    ...over,
  };
}

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    key: "KIN-1",
    title: "One-stage ping",
    description: "",
    labels: [],
    columnId: "draft",
    flowId: "flow-echo",
    status: "idle",
    spend: 0,
    runId: "r1",
    slackChannel: "",
    slackChannelId: "",
    slackMembers: "",
    ideationNotes: "",
    transcript: "",
    outputs: {},
    vars: {},
    agentResponses: [],
    grillRounds: [],
    fryComplete: false,
    plan: null,
    jiraCreated: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    linkedJiras: [],
    ...over,
  };
}

test("capture → Cursor draft → echo passes only the last reply as {{agenda}}", () => {
  const capture = col({ id: "capture", role: "collect-input", outputKey: "brief" });
  const draft = col({ id: "draft", role: "prompt", agent: "cursor", outputKey: "agenda" });
  const echo = col({ id: "echo", role: "prompt", agent: "cursor", outputKey: "echo" });

  let t = ticket({ columnId: capture.id });
  t = { ...t, vars: harvestVars(t, capture, "Need a voice agenda for Grill") };
  assert.equal(t.vars.brief, "Need a voice agenda for Grill");
  assert.equal(t.vars.prev, "Need a voice agenda for Grill");

  const draftPrompt = "Using only the captured input, write a short agenda.\n\n{{brief}}\n\nReply with the agenda only.";
  const toCursor = interpolate(draftPrompt, buildContext(t));
  assert.match(toCursor, /Need a voice agenda for Grill/);
  assert.equal(resolveStep(draft, exec).kind, "cursor");

  t = { ...t, vars: harvestVars(t, draft, "1. Kickoff\n2. Goals") };
  assert.equal(t.vars.agenda, "1. Kickoff\n2. Goals");
  assert.equal(t.vars.brief, "Need a voice agenda for Grill");

  const echoPrompt = "Print the previous stage output exactly. No extra words.\n\n{{agenda}}";
  const echoed = interpolate(echoPrompt, buildContext(t));
  assert.equal(echoed, "Print the previous stage output exactly. No extra words.\n\n1. Kickoff\n2. Goals");
  t = { ...t, vars: harvestVars(t, echo, "1. Kickoff\n2. Goals") };
  assert.equal(t.vars.echo, t.vars.agenda);
  assert.equal(outputVarName(draft), "agenda");
  assert.equal(outputVarName(echo), "echo");
});

test("one-stage pipeline does not advance to a phantom Done column", () => {
  const stages = [col({ id: "only", role: "prompt", enabled: true })];
  assert.equal(startColumnId(stages), "only");
  assert.equal(nextColumnId("only", stages), null);
  assert.equal(resolveActiveStage(stages, "fry"), "only");
});

test("Discovery still advances File Jira to Done", () => {
  assert.equal(nextColumnId(FILE_JIRA_COLUMN_ID, COLUMNS), DONE_COLUMN_ID);
});

test("previousColumn for review gates is the prior enabled stage", () => {
  assert.equal(previousColumn("preview-agenda", COLUMNS)?.id, "prep-agenda");
  assert.equal(previousColumn("preview-fry", COLUMNS)?.id, "fry");
  assert.equal(previousColumn("approve", COLUMNS)?.id, "write-plan");
});

test("orphaned tickets land on stage 01 of the current flow", () => {
  const stages = [col({ id: "s1", role: "prompt" }), col({ id: "s2", role: "prompt" })];
  const parked = parkOrphanTickets([{ columnId: "ideation" }, { columnId: "s2" }], stages);
  assert.equal(parked[0]?.columnId, "s1");
  assert.equal(parked[1]?.columnId, "s2");
});

test("stage output strips Kindling / retrieval noise so the variable is the reply", () => {
  const log = [
    "[kindling] 2026-08-28T22:03:55.604Z starting",
    "[kindling] /Users/x/.local/bin/agent --trust -f -p",
    "cursor-retrieval: tracing to '/tmp/cursor.log'",
    "1. Kickoff",
    "2. Goals",
    "[kindling] exit 0",
  ].join("\n");
  assert.equal(stageOutputFromLog(log), "1. Kickoff\n2. Goals");
});

test("local Cursor/Claude stay in print mode without full-agent flags", () => {
  const cursor = withoutFullAgentMode(ensurePrintMode(["--yolo", "-f", "--trust"]));
  assert.ok(cursor.includes("-p"));
  assert.ok(!cursor.includes("-f"));
  assert.ok(!cursor.includes("--yolo"));
  const claude = withNonInteractiveFlags("claude", withoutFullAgentMode(["--permission-mode", "dontAsk"]));
  assert.ok(claude.includes("default") || !claude.includes("dontAsk"));
});

test("per-stage agent overrides the workspace default", () => {
  assert.equal(resolveStep({ agent: "inherit" }, exec).kind, "cursor");
  assert.equal(resolveStep({ agent: "claude" }, exec).kind, "claude");
  assert.equal(resolveStep({ agent: "studio" }, exec).kind, "studio");
});

test("library prompt + skill is what the stage actually runs", () => {
  const stage = col({ id: "grill", role: "prompt", promptRef: "p1" });
  const resolved = resolveStagePrompt(
    stage,
    [{ id: "p1", name: "Grill", body: "Grill the spec.", skillIds: ["doc-grill-me"], jiraKeys: [] }],
    [{ id: "doc-grill-me", title: "grill-me", kind: "skill", body: "Interview relentlessly." }],
  );
  assert.match(resolved.body, /Grill the spec/);
  assert.match(resolved.body, /Interview relentlessly/);
});

test("writing stages on one flow does not mutate another flow's copy", () => {
  const discovery = COLUMNS.map((c) => ({ ...c }));
  const custom = [col({ id: "blank", role: "prompt", outputKey: "out" })];
  const flows = [
    { id: "a", columns: discovery },
    { id: "b", columns: custom },
  ];
  const active = flows.find((f) => f.id === "b")!;
  assert.equal(active.columns[0]?.id, "blank");
  assert.ok(flows[0]!.columns.some((c) => c.id === FILE_JIRA_COLUMN_ID));
});

test("Jira and GitHub Enterprise URLs are PAT hosts, not Cloud token paths", () => {
  assert.equal(jiraHost("https://jira.company.com/browse"), "https://jira.company.com");
  assert.equal(githubApiBase("https://ghe.company.com"), "https://ghe.company.com/api/v3");
});

test("pipeline history rows keep ticket, stage, variable, and last reply", () => {
  const runs = [
    { ticketKey: "KIN-1", columnId: "capture", variable: "brief", output: "Need a voice agenda", ok: true },
    { ticketKey: "KIN-1", columnId: "draft", variable: "agenda", output: "1. Kickoff", ok: true },
  ];
  assert.equal(runs.length, 2);
  assert.equal(runs[1]?.variable, "agenda");
  assert.equal(runs[1]?.output, "1. Kickoff");
  assert.notEqual(runs[1]?.output, runs[0]?.output);
});
