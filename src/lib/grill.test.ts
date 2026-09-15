import assert from "node:assert/strict";
import { test } from "node:test";
import { assignQuestions, answeredCount, flattenFryQa, formatFryRecord, fryConclusions, fryQuestionVars } from "./grill.ts";
import { harvestFryVars } from "./flow-context.ts";
import { beginStageRun } from "./sample-data.ts";
import { COLUMNS } from "./columns.ts";
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
  assert.equal(fryConclusions({ outputs: { fryme: "new", fry: "old" }, vars: {} }), "new");
  assert.equal(fryConclusions({ outputs: { fry: "old" }, vars: {} }), "old");
});

test("answeredCount ignores whitespace", () => {
  const qs: FryQuestion[] = [
    { n: 1, question: "a", recommended: "r", answer: " yes " },
    { n: 2, question: "b", recommended: "r", answer: "   " },
  ];
  assert.equal(answeredCount(qs), 1);
});

test("harvestFryVars publishes per-question output vars and the full Q&A record", () => {
  const ticket = {
    outputs: { fryme: "Honor the registry pin." },
    vars: {},
    fryComplete: true,
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
            source: "Architecture & Design Decisions",
            answeredBy: "Maya Chen",
          },
        ],
      },
      {
        id: "r2",
        submitted: true,
        questions: [
          {
            n: 1,
            question: "Is a migration required?",
            recommended: "No — new registry only.",
            answer: "No migration",
            source: "Data Model & Storage",
          },
        ],
      },
    ],
  } as unknown as Ticket;
  const items = flattenFryQa(ticket);
  assert.equal(items.length, 2);
  assert.equal(items[1]?.n, 2);
  assert.equal(items[1]?.round, 2);
  const vars = harvestFryVars(ticket);
  assert.match(vars.fryme, /Where do prompts live/);
  assert.match(vars.fryme, /Registry keyed by column/);
  assert.match(vars.fryme, /No migration/);
  assert.equal(vars["fryme.1.question"], "Where do prompts live?");
  assert.equal(vars["fryme.1.answer"], "Registry keyed by column");
  assert.equal(vars["fryme.2.answer"], "No migration");
  assert.equal(vars["fryme.conclusions"], "Honor the registry pin.");
  assert.match(vars["fryme.qa"] ?? "", /"answer": "Registry keyed by column"/);
  assert.equal(fryQuestionVars(ticket)["fryme.1.source"], "Architecture & Design Decisions");
});

test("beginStageRun keeps Fry Me Q&A vars between rounds and clears them on a fresh start", () => {
  const col = COLUMNS.find((c) => c.id === "fryme")!;
  const ticket = {
    outputs: { fryme: "" },
    vars: {
      fryme: "Round 1 record",
      "fryme.1.question": "Where do prompts live?",
      "fryme.1.answer": "Registry",
      spec: "keep spec",
    },
    fryComplete: false,
    fryRounds: [
      {
        id: "r1",
        submitted: true,
        questions: [{ n: 1, question: "Where do prompts live?", recommended: "Registry", answer: "Registry" }],
      },
    ],
  } as unknown as Ticket;
  const kept = beginStageRun(ticket, col, { keepFryRounds: true });
  assert.equal(kept.vars["fryme.1.answer"], "Registry");
  assert.equal(kept.vars.fryme, "Round 1 record");
  assert.equal(kept.fryRounds.length, 1);
  const fresh = beginStageRun(ticket, col);
  assert.equal(fresh.vars["fryme.1.answer"], undefined);
  assert.equal(fresh.vars.fryme, undefined);
  assert.equal(fresh.vars.spec, "keep spec");
  assert.equal(fresh.fryRounds.length, 0);
});
