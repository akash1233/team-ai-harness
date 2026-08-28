import assert from "node:assert/strict";
import { test } from "node:test";
import { ensurePrintMode, explainCliFailure, isNoiseLog, resolveCursorModel, toInteractiveArgs, withCursorWorkspace, withoutFullAgentMode, withNonInteractiveFlags } from "./cli-session.ts";

test("Cursor print mode does not add --trust or -f", () => {
  assert.deepEqual(withNonInteractiveFlags("cursor", ["-p", "--output-format", "text"]), [
    "-p",
    "--output-format",
    "text",
  ]);
});

test("does not duplicate --trust", () => {
  const args = withNonInteractiveFlags("cursor", ["--trust", "-p"]);
  assert.equal(args.filter((a) => a === "--trust").length, 1);
});

test("Claude print mode uses permission-mode default, not auto", () => {
  assert.deepEqual(withNonInteractiveFlags("claude", ["-p"]), ["--permission-mode", "default", "-p"]);
});

test("trust prompt is translated", () => {
  const msg = explainCliFailure("⚠ Workspace Trust Required\nDo you trust the contents of this directory?");
  assert.match(msg, /permissions\.json/);
});

test("interactive mode drops -p and output-format", () => {
  assert.deepEqual(
    toInteractiveArgs(["--trust", "-f", "-p", "--output-format", "text", "--model", "composer-1"]),
    ["--trust", "-f", "--model", "composer-1"],
  );
});

test("withoutFullAgentMode strips yolo, force, and dontAsk", () => {
  assert.deepEqual(withoutFullAgentMode(["--trust", "-f", "--yolo", "-p"]), ["--trust", "-p"]);
  assert.deepEqual(withoutFullAgentMode(["--permission-mode", "dontAsk", "-p"]), ["-p"]);
});

test("ensurePrintMode adds -p when missing", () => {
  assert.deepEqual(ensurePrintMode(["--trust"]), ["-p", "--output-format", "text", "--trust"]);
});

test("composer-1 remaps to auto", () => {
  assert.equal(resolveCursorModel("composer-1"), "auto");
  assert.equal(resolveCursorModel("composer-2.5"), "composer-2.5");
});

test("cursor gets --workspace", () => {
  assert.deepEqual(withCursorWorkspace(["-p"], "/tmp/repo"), ["--workspace", "/tmp/repo", "-p"]);
});

test("retrieval-only log is noise", () => {
  assert.equal(isNoiseLog("cursor-retrieval: tracing to '/tmp/x.log'"), true);
  assert.equal(isNoiseLog("pong"), false);
});
