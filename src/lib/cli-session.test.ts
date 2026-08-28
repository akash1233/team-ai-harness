import assert from "node:assert/strict";
import { test } from "node:test";
import { explainCliFailure, shellQuote, withNonInteractiveFlags } from "./cli-session.ts";

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

test("Claude gets permission-mode dontAsk", () => {
  assert.deepEqual(withNonInteractiveFlags("claude", ["-p"]), ["--permission-mode", "dontAsk", "-p"]);
});

test("trust prompt is translated", () => {
  const msg = explainCliFailure("⚠ Workspace Trust Required\nDo you trust the contents of this directory?");
  assert.match(msg, /--trust/);
});

test("shellQuote wraps spaces", () => {
  assert.equal(shellQuote("a b"), "'a b'");
});
