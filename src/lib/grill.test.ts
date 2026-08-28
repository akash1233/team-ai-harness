import assert from "node:assert/strict";
import { test } from "node:test";
import { assignQuestions, answeredCount, formatGrillRecord } from "./grill.ts";
import type { GrillQuestion, Ticket } from "./types.ts";

const members = [
  { id: "m-maya", name: "Maya Chen", handle: "@maya", role: "Product" },
  { id: "m-jon", name: "Jon Hale", handle: "@jon", role: "Engineering" },
];

test("round-robins grill questions across the team", () => {
  const qs: GrillQuestion[] = [
    { n: 1, question: "a", recommended: "ra", answer: "" },
    { n: 2, question: "b", recommended: "rb", answer: "" },
    { n: 3, question: "c", recommended: "rc", answer: "" },
  ];
  const assigned = assignQuestions(qs, members);
  assert.equal(assigned[0]?.assigneeId, "m-maya");
  assert.equal(assigned[1]?.assigneeId, "m-jon");
  assert.equal(assigned[2]?.assigneeId, "m-maya");
});

test("formatGrillRecord is what Write plan consumes", () => {
  const ticket = {
    outputs: { fry: "" },
    fryComplete: false,
    grillRounds: [
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
  const record = formatGrillRecord(ticket);
  assert.match(record, /Where do prompts live/);
  assert.match(record, /Registry keyed by column/);
  assert.match(record, /Maya Chen/);
});

test("answeredCount ignores whitespace", () => {
  const qs: GrillQuestion[] = [
    { n: 1, question: "a", recommended: "r", answer: " yes " },
    { n: 2, question: "b", recommended: "r", answer: "   " },
  ];
  assert.equal(answeredCount(qs), 1);
});
