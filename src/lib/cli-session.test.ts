import assert from "node:assert/strict";
import { test } from "node:test";
import { explainCliFailure, toInteractiveArgs, withoutAutoMode, withNonInteractiveFlags } from "./cli-session.ts";

test("Cursor print mode always gets --trust -f", () => {
  assert.deepEqual(withNonInteractiveFlags("cursor", ["-p", "--output-format", "text"]), [
    "--trust",
    "-f",
    "-p",
    "--output-format",
    "text",
  ]);
});

test("does not duplicate --trust", () => {
  const args = withNonInteractiveFlags("cursor", ["--trust", "-p"]);
  assert.equal(args.filter((a) => a === "--trust").length, 1);
});

test("Claude print mode does not add auto permissions", () => {
  assert.deepEqual(withNonInteractiveFlags("claude", ["-p"]), ["-p"]);
});

test("trust prompt is translated", () => {
  const msg = explainCliFailure("⚠ Workspace Trust Required\nDo you trust the contents of this directory?");
  assert.match(msg, /--trust/);
});

test("interactive mode drops -p and output-format", () => {
  assert.deepEqual(
    toInteractiveArgs(["--trust", "-f", "-p", "--output-format", "text", "--model", "composer-1"]),
    ["--trust", "-f", "--model", "composer-1"],
  );
});

test("withoutAutoMode strips dontAsk", () => {
  assert.deepEqual(withoutAutoMode(["--permission-mode", "dontAsk", "-p"]), ["-p"]);
});
