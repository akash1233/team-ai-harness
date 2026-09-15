import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractFileJiraMcpResult,
  fileJiraMcpSucceeded,
  jiraProjectFromKey,
  planStepKind,
} from "./discovery-jira.ts";
import type { Plan } from "./types.ts";

const plan: Plan = {
  summary: "Pin prompts on the ticket.",
  findings: [],
  scope: [],
  outOfScope: [],
  risks: [],
  steps: [
    { title: "Epic: Prompt registry", detail: "Store versioned prompts.", references: [] },
    { title: "Story: Pin prompt version", detail: "Pin sha at start.", references: ["Epic: Prompt registry"] },
  ],
};

test("jiraProjectFromKey reads the project prefix", () => {
  assert.equal(jiraProjectFromKey("X2-698"), "X2");
  assert.equal(jiraProjectFromKey("x2-1"), "X2");
  assert.equal(jiraProjectFromKey("not-a-key"), "");
});

test("planStepKind uses Epic:/Story: prefixes", () => {
  assert.equal(planStepKind("Epic: Prompt registry"), "epic");
  assert.equal(planStepKind("Story: Pin prompt version"), "story");
});

test("extractFileJiraMcpResult parses browse links and maps plan order", () => {
  const log = `
createNewJiraTicket projectKey=X2 issueType=Epic
Created [X2-910](https://jira2.workday.com/browse/X2-910)
createNewJiraTicket projectKey=X2 issueType=Story epicLink=X2-910
Created [X2-911](https://jira2.workday.com/browse/X2-911)
`;
  const hit = extractFileJiraMcpResult(log, plan, { project: "X2", excludeKeys: ["X2-698"] });
  assert.equal(hit.found, true);
  assert.deepEqual(
    hit.issues.map((issue) => `${issue.kind}:${issue.key}`),
    ["epic:X2-910", "story:X2-911"],
  );
  assert.match(hit.display, /X2-910/);
  assert.match(hit.display, /Prompt registry/);
});

test("extractFileJiraMcpResult ignores the source ticket and other projects", () => {
  const log = `
Filing plan for X2-698
createNewJiraTicket example LSAA-100
Created [X2-912](https://jira2.workday.com/browse/X2-912)
`;
  const hit = extractFileJiraMcpResult(log, plan, { project: "X2", excludeKeys: ["X2-698"] });
  assert.equal(hit.found, true);
  assert.deepEqual(hit.issues.map((issue) => issue.key), ["X2-912"]);
});

test("extractFileJiraMcpResult returns not found for prompt-only noise", () => {
  const log = "[kindling] starting\nFile this signed-off plan using createNewJiraTicket\nX2-698\n";
  const hit = extractFileJiraMcpResult(log, plan, { project: "X2", excludeKeys: ["X2-698"] });
  assert.equal(hit.found, false);
  assert.equal(fileJiraMcpSucceeded(log, { project: "X2", excludeKeys: ["X2-698"] }), false);
});
