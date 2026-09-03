import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, DONE_COLUMN_ID, IDEATION_COLUMN_ID, SYNTHESIZE_COLUMN_ID } from "./columns.ts";
import { previewLine, stagePurpose } from "./stage-purpose.ts";

test("stagePurpose uses output key and role, not last-run text", () => {
  const brief = COLUMNS.find((c) => c.id === IDEATION_COLUMN_ID)!;
  const spec = COLUMNS.find((c) => c.id === SYNTHESIZE_COLUMN_ID)!;
  const done = COLUMNS.find((c) => c.id === DONE_COLUMN_ID)!;
  assert.match(stagePurpose(brief), /\{\{brief\}\}/);
  assert.match(stagePurpose(brief), /You add this/);
  assert.match(stagePurpose(spec), /\{\{spec\}\}/);
  assert.match(stagePurpose(spec), /Agent writes/);
  assert.match(stagePurpose(done), /Finished/);
});

test("previewLine is a single short line", () => {
  const dump = "Sentinel - Bug Bash\nDate: August 28, 2026\nAttendees: everyone";
  assert.equal(previewLine(dump), "Sentinel - Bug Bash");
  assert.ok(previewLine("x".repeat(200)).endsWith("…"));
});
