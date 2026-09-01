import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, FRY_COLUMN_ID, PREP_AGENDA_COLUMN_ID, SEND_SLACK_COLUMN_ID } from "./columns.ts";
import { bindJiraKey, createDefaultPrompts, mergePrompts, resolveStagePrompt, unbindJiraKey } from "./prompts.ts";
import type { TeamDoc } from "./types.ts";

test("Notify column defaults to Cursor with slackMessage prompt", () => {
  const notify = COLUMNS.find((c) => c.id === SEND_SLACK_COLUMN_ID);
  assert.equal(notify?.agent, "cursor");
  assert.match(notify?.promptTemplate ?? "", /\{\{slackMessage\}\}/);
  assert.match(notify?.promptTemplate ?? "", /slack-mcp/);
});

test("default prompts seed from stages and Grill attaches grill-me skill", () => {
  const prompts = createDefaultPrompts(COLUMNS);
  const agenda = prompts.find((p) => p.id === `prompt-${PREP_AGENDA_COLUMN_ID}`);
  const grill = prompts.find((p) => p.id === `prompt-${FRY_COLUMN_ID}`);
  const notify = prompts.find((p) => p.id === `prompt-${SEND_SLACK_COLUMN_ID}`);
  assert.ok(agenda?.body.includes("Team Discussion Agenda"));
  assert.match(notify?.body ?? "", /\{\{slackMessage\}\}/);
  assert.deepEqual(grill?.skillIds, ["doc-grill-me"]);
});

test("mergePrompts migrates stale Notify prompt body to canonical template", () => {
  const merged = mergePrompts(
    [{ id: `prompt-${SEND_SLACK_COLUMN_ID}`, name: "Notify", body: "Post the approved meeting agenda to Slack. One action.", skillIds: [], jiraKeys: [] }],
    COLUMNS,
  );
  const notify = merged.find((p) => p.id === `prompt-${SEND_SLACK_COLUMN_ID}`);
  assert.match(notify?.body ?? "", /\{\{slackMessage\}\}/);
  assert.match(notify?.body ?? "", /slack-mcp/);
});

test("resolveStagePrompt uses canonical Notify body even when library is stale", () => {
  const col = COLUMNS.find((c) => c.id === SEND_SLACK_COLUMN_ID)!;
  const prompts = [{ id: `prompt-${SEND_SLACK_COLUMN_ID}`, name: "Notify", body: "old one-liner", skillIds: [], jiraKeys: [] }];
  const resolved = resolveStagePrompt(col, prompts, []);
  assert.match(resolved.body, /\{\{slackMessage\}\}/);
  assert.doesNotMatch(resolved.body, /old one-liner/);
});

test("resolveStagePrompt appends attached skills into the body", () => {
  const col = COLUMNS.find((c) => c.id === FRY_COLUMN_ID)!;
  const prompts = createDefaultPrompts(COLUMNS);
  const docs: TeamDoc[] = [
    { id: "doc-grill-me", title: "grill-me", kind: "skill", body: "Interview relentlessly." },
  ];
  const resolved = resolveStagePrompt({ ...col, promptRef: `prompt-${FRY_COLUMN_ID}` }, prompts, docs);
  assert.match(resolved.body, /Interview relentlessly/);
  assert.match(resolved.body, /<skill name="grill-me">/);
});

test("resolveStagePrompt carries prompt-bound Jira keys", () => {
  const col = COLUMNS.find((c) => c.id === PREP_AGENDA_COLUMN_ID)!;
  const prompts = createDefaultPrompts(COLUMNS).map((prompt) =>
    prompt.id === `prompt-${PREP_AGENDA_COLUMN_ID}`
      ? { ...prompt, jiraKeys: ["X2-123", "X2-456"] }
      : prompt,
  );
  assert.deepEqual(resolveStagePrompt(col, prompts, []).jiraKeys, ["X2-123", "X2-456"]);
});

test("Jira prompt bindings add and remove keys case-insensitively", () => {
  assert.deepEqual(bindJiraKey(["x2-123", "X2-456"], " X2-123 "), ["X2-456", "X2-123"]);
  assert.deepEqual(unbindJiraKey(["x2-123", "X2-456"], "X2-123"), ["X2-456"]);
  assert.deepEqual(bindJiraKey([], "  "), []);
});

test("mergePrompts replaces stale Agenda body with the flow JSON prompt", () => {
  const merged = mergePrompts(
    [{ id: `prompt-${PREP_AGENDA_COLUMN_ID}`, name: "Agenda", body: "{{brief}}\nJira details :\n{{jira}}", skillIds: [], jiraKeys: [] }],
    COLUMNS,
  );
  const agenda = merged.find((p) => p.id === `prompt-${PREP_AGENDA_COLUMN_ID}`);
  assert.match(agenda?.body ?? "", /Brief \(logistics\)/);
  assert.doesNotMatch(agenda?.body ?? "", /Jira details :/);
});

test("mergePrompts canonicalizes seeded defaults from the flow JSON", () => {
  const merged = mergePrompts(undefined, COLUMNS);
  const spec = merged.find((p) => p.id === "prompt-synthesize");
  assert.match(spec?.body ?? "", /Turn the current conversation into a spec/);
});

test("mergeColumns replaces stale column promptTemplate with the flow JSON prompt", async () => {
  const { mergeColumns } = await import("./team-config.ts");
  const merged = mergeColumns(
    COLUMNS.map((c) =>
      c.id === PREP_AGENDA_COLUMN_ID ? { ...c, promptTemplate: "{{brief}}\nJira details :\n{{jira}}" } : c,
    ),
  );
  const agenda = merged.find((c) => c.id === PREP_AGENDA_COLUMN_ID);
  assert.match(agenda?.promptTemplate ?? "", /Brief \(logistics\)/);
  assert.doesNotMatch(agenda?.promptTemplate ?? "", /Jira details :/);
});
