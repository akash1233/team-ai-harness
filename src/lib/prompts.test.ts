import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, FRY_COLUMN_ID, PREP_AGENDA_COLUMN_ID } from "./columns.ts";
import { createDefaultPrompts, resolveStagePrompt } from "./prompts.ts";
import type { TeamDoc } from "./types.ts";

test("default prompts seed from stages and Grill attaches grill-me skill", () => {
  const prompts = createDefaultPrompts(COLUMNS);
  const agenda = prompts.find((p) => p.id === `prompt-${PREP_AGENDA_COLUMN_ID}`);
  const grill = prompts.find((p) => p.id === `prompt-${FRY_COLUMN_ID}`);
  assert.ok(agenda?.body.includes("Team Discussion Agenda"));
  assert.deepEqual(grill?.skillIds, ["doc-grill-me"]);
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
