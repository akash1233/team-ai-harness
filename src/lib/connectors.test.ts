import assert from "node:assert/strict";
import { test } from "node:test";
import { connectorVars, formatJiraRefs, githubApiBase, hydrateLinkedJiras, jiraHost, mergeJiraIssues } from "./connectors.ts";

test("githubApiBase adds /api/v3 for GHE hosts", () => {
  assert.equal(githubApiBase("https://ghe.company.com"), "https://ghe.company.com/api/v3");
  assert.equal(githubApiBase("https://ghe.company.com/api/v3"), "https://ghe.company.com/api/v3");
  assert.equal(githubApiBase(""), "https://api.github.com");
});

test("jiraHost strips browse", () => {
  assert.equal(jiraHost("https://jira.company.com/browse"), "https://jira.company.com");
});

test("connectorVars seed pipeline context", () => {
  const vars = connectorVars(
    { key: "X2-698", title: "Prompts", status: "Open", url: "https://jira/x", description: "body" },
    { fullName: "org/kindling", name: "kindling", url: "https://ghe/org/kindling", defaultBranch: "main", description: "" },
  );
  assert.equal(vars["jira.key"], "X2-698");
  assert.equal(vars.repo, "org/kindling");
});

test("hydrateLinkedJiras migrates a legacy single Jira issue", () => {
  const issue = { key: "X2-698", title: "Prompts", status: "Open", url: "https://jira/x", description: "body" };
  assert.deepEqual(hydrateLinkedJiras(undefined, issue), [issue]);
  assert.deepEqual(hydrateLinkedJiras([], issue), []);
});

test("mergeJiraIssues keeps ticket order and de-duplicates prompt issues", () => {
  const ticketIssue = { key: "X2-1", title: "Ticket", status: "Open", url: "", description: "ticket" };
  const promptIssue = { key: "X2-2", title: "Prompt", status: "Open", url: "", description: "prompt" };
  assert.deepEqual(mergeJiraIssues([ticketIssue], [{ ...ticketIssue, title: "Duplicate" }, promptIssue]), [
    ticketIssue,
    promptIssue,
  ]);
});

test("formatJiraRefs renders one compact line per Jira issue", () => {
  assert.equal(formatJiraRefs([]), "");
  assert.equal(
    formatJiraRefs([
      { key: "X2-1", title: "First", status: "Open", url: "https://jira/X2-1", description: "" },
      { key: "X2-2", title: "Second", status: "Done", url: "https://jira/X2-2", description: "" },
    ]),
    "X2-1 First — https://jira/X2-1\nX2-2 Second — https://jira/X2-2",
  );
});
