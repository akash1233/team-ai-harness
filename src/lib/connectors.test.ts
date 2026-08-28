import assert from "node:assert/strict";
import { test } from "node:test";
import { connectorVars, githubApiBase, jiraHost } from "./connectors.ts";

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
