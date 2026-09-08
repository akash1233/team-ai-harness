import assert from "node:assert/strict";
import { test } from "node:test";
import { assignQuestions, answeredCount, formatFryRecord, fryConclusions } from "./grill.ts";
import { migrateTicketFry, type LegacyTicket } from "./fry-migrate.ts";
import type { FryQuestion, Ticket } from "./types.ts";

const members = [
  { id: "m-maya", name: "Maya Chen", handle: "@maya", role: "Product" },
  { id: "m-jon", name: "Jon Hale", handle: "@jon", role: "Engineering" },
];

test("round-robins grill questions across the team", () => {
  const qs: FryQuestion[] = [
    { n: 1, question: "a", recommended: "ra", answer: "" },
    { n: 2, question: "b", recommended: "rb", answer: "" },
    { n: 3, question: "c", recommended: "rc", answer: "" },
  ];
  const assigned = assignQuestions(qs, members);
  assert.equal(assigned[0]?.assigneeId, "m-maya");
  assert.equal(assigned[1]?.assigneeId, "m-jon");
  assert.equal(assigned[2]?.assigneeId, "m-maya");
});

test("formatFryRecord is what Write plan consumes", () => {
  const ticket = {
    outputs: { fryme: "" },
    fryComplete: false,
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
            answeredBy: "Maya Chen",
          },
        ],
      },
    ],
  } as unknown as Ticket;
  const record = formatFryRecord(ticket);
  assert.match(record, /Where do prompts live/);
  assert.match(record, /Registry keyed by column/);
  assert.match(record, /Maya Chen/);
});

test("migrateTicketFry maps legacy grill fields onto fryme", () => {
  const ticket = migrateTicketFry({
    id: "t1",
    key: "X2-1",
    title: "x",
    description: "",
    labels: [],
    columnId: "fry",
    flowId: "flow-discovery",
    status: "idle",
    spend: 0,
    runId: "",
    slackChannel: "",
    slackChannelId: "",
    slackMembers: "",
    ideationNotes: "",
    transcript: "",
    outputs: { fry: "conclusions" },
    vars: { grill: "old record" },
    agentResponses: [{ id: "a", at: "t", columnId: "fry", summary: "round", body: "" }],
    fryRounds: [],
    grillRounds: [
      {
        id: "r1",
        submitted: true,
        questions: [{ n: 1, question: "q", recommended: "r", answer: "a" }],
      },
    ],
    fryComplete: false,
    plan: null,
    jiraCreated: [],
    createdAt: "t",
    linkedJiras: [],
  } as LegacyTicket);
  assert.equal(ticket.columnId, "fryme");
  assert.equal(ticket.vars.fryme, "old record");
  assert.equal(ticket.vars.grill, "old record");
  assert.equal(ticket.outputs.fryme, "conclusions");
  assert.equal(ticket.fryRounds.length, 1);
  assert.equal(ticket.agentResponses[0]?.columnId, "fryme");
});

test("migrateTicketFry copies preview-fry output and vars.fry", () => {
  const ticket = migrateTicketFry({
    id: "t1",
    key: "X2-1",
    title: "x",
    description: "",
    labels: [],
    columnId: "preview-fry",
    flowId: "flow-discovery",
    status: "idle",
    spend: 0,
    runId: "",
    slackChannel: "",
    slackChannelId: "",
    slackMembers: "",
    ideationNotes: "",
    transcript: "",
    outputs: { "preview-fry": "approved record" },
    vars: { fry: "old record" },
    agentResponses: [],
    fryRounds: [],
    fryComplete: false,
    plan: null,
    jiraCreated: [],
    createdAt: "t",
    linkedJiras: [],
  } as LegacyTicket);
  assert.equal(ticket.columnId, "preview-fryme");
  assert.equal(ticket.vars.fryme, "old record");
  assert.equal(ticket.outputs["preview-fryme"], "approved record");
});

test("fryConclusions reads fryme first and falls back to fry", () => {
  assert.equal(fryConclusions({ outputs: { fryme: "new", fry: "old" } } as Ticket), "new");
  assert.equal(fryConclusions({ outputs: { fry: "old" } } as Ticket), "old");
});

test("answeredCount ignores whitespace", () => {
  const qs: FryQuestion[] = [
    { n: 1, question: "a", recommended: "r", answer: " yes " },
    { n: 2, question: "b", recommended: "r", answer: "   " },
  ];
  assert.equal(answeredCount(qs), 1);
});
