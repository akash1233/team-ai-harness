import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, FRY_COLUMN_ID, PREP_AGENDA_COLUMN_ID, SEND_SLACK_COLUMN_ID, SYNTHESIZE_COLUMN_ID } from "./columns.ts";
import { bindJiraKey, createDefaultPrompts, mergePrompts, resolveStagePrompt, unbindJiraKey } from "./prompts.ts";
import type { TeamDoc } from "./types.ts";

test("Notify column defaults to Cursor with slackMessage prompt", () => {
  const notify = COLUMNS.find((c) => c.id === SEND_SLACK_COLUMN_ID);
  assert.equal(notify?.agent, "cursor");
  assert.match(notify?.promptTemplate ?? "", /\{\{slackMessage\}\}/);
  assert.match(notify?.promptTemplate ?? "", /slack-mcp/);
});

test("File Jira column defaults to Cursor TUI with jira-ghe createNewJiraTicket", () => {
  const fileJira = COLUMNS.find((c) => c.id === "file-jira");
  assert.equal(fileJira?.agent, "cursor");
  assert.equal(fileJira?.cli, "tui");
  assert.match(fileJira?.promptTemplate ?? "", /createNewJiraTicket/);
  assert.match(fileJira?.promptTemplate ?? "", /\{\{plan\}\}/);
});

test("default prompts seed from stages and Fry Me attaches fry-me skill", () => {
  const prompts = createDefaultPrompts(COLUMNS);
  const agenda = prompts.find((p) => p.id === `prompt-${PREP_AGENDA_COLUMN_ID}`);
  const grill = prompts.find((p) => p.id === `prompt-${FRY_COLUMN_ID}`);
  const notify = prompts.find((p) => p.id === `prompt-${SEND_SLACK_COLUMN_ID}`);
  assert.ok(agenda?.body.includes("Team Discussion Agenda"));
  assert.match(notify?.body ?? "", /\{\{slackMessage\}\}/);
  assert.deepEqual(grill?.skillIds, ["doc-fry-me"]);
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

test("resolveStagePrompt uses the session library body, including Notify", () => {
  const col = COLUMNS.find((c) => c.id === SEND_SLACK_COLUMN_ID)!;
  const prompts = [{ id: `prompt-${SEND_SLACK_COLUMN_ID}`, name: "Notify", body: "session edit {{slackMessage}}", skillIds: [], jiraKeys: [] }];
  const resolved = resolveStagePrompt(col, prompts, []);
  assert.match(resolved.body, /session edit \{\{slackMessage\}\}/);
  assert.equal(resolved.baseBody, "session edit {{slackMessage}}");
});

test("resolveStagePrompt appends attached skills into the body", () => {
  const col = COLUMNS.find((c) => c.id === FRY_COLUMN_ID)!;
  const prompts = createDefaultPrompts(COLUMNS);
  const docs: TeamDoc[] = [
    { id: "doc-fry-me", title: "fry-me", kind: "skill", body: "Interview relentlessly." },
  ];
  const resolved = resolveStagePrompt({ ...col, promptRef: `prompt-${FRY_COLUMN_ID}` }, prompts, docs);
  assert.match(resolved.body, /Interview relentlessly/);
  assert.match(resolved.body, /<skill name="fry-me">/);
});

test("legacy Grill Me prompt and skill ids still resolve after the Fry Me rename", () => {
  const col = COLUMNS.find((c) => c.id === FRY_COLUMN_ID)!;
  const prompts = mergePrompts(
    [{ id: "prompt-fry", name: "Grill Me", body: "legacy fry prompt", skillIds: ["doc-grill-me"], jiraKeys: [] }],
    COLUMNS,
  );
  const grill = prompts.find((p) => p.id === `prompt-${FRY_COLUMN_ID}`);
  assert.ok(grill);
  assert.deepEqual(grill?.skillIds, ["doc-fry-me"]);
  const resolved = resolveStagePrompt(
    { ...col, promptRef: "prompt-fry" },
    [{ id: "prompt-fry", name: "Grill Me", body: "legacy fry prompt", skillIds: ["doc-grill-me"], jiraKeys: [] }],
    [{ id: "doc-grill-me", title: "grill-me", kind: "skill", body: "Interview relentlessly." }],
  );
  assert.match(resolved.body, /legacy fry prompt/);
  assert.match(resolved.body, /Interview relentlessly/);
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

test("mergeDocs reloads the shipped Fry Me skill over a saved Grill Me body", async () => {
  const { mergeDocs } = await import("./team-config.ts");
  const { FRY_ME_SKILL } = await import("./grill-skill.ts");
  const merged = mergeDocs([
    { id: "doc-grill-me", title: "Grill Me", kind: "skill", body: "You are Grill Me. Interview relentlessly." },
    { id: "doc-discovery-conventions", title: "Discovery conventions", kind: "notes", body: "custom notes" },
  ]);
  const skill = merged.find((d) => d.id === "doc-fry-me");
  assert.equal(skill?.title, "Fry Me skill");
  assert.equal(skill?.body, FRY_ME_SKILL);
  assert.match(skill?.body ?? "", /Problem Statement & Scope/);
  assert.equal(merged.find((d) => d.id === "doc-discovery-conventions")?.body, "custom notes");
});

test("mergeColumns discards saved columns and reloads discovery.flow.json", async () => {
  const { mergeColumns } = await import("./team-config.ts");
  const merged = mergeColumns(
    COLUMNS.map((c) =>
      c.id === PREP_AGENDA_COLUMN_ID ? { ...c, promptTemplate: "{{brief}}\nJira details :\n{{jira}}" } : c,
    ),
  );
  const agenda = merged.find((c) => c.id === PREP_AGENDA_COLUMN_ID);
  assert.match(agenda?.promptTemplate ?? "", /Brief \(logistics\)/);
  assert.doesNotMatch(agenda?.promptTemplate ?? "", /Jira details :/);
  assert.equal(
    merged.some((c) => c.id === "blocked"),
    false,
  );
});

test("mergeColumns applies flow JSON agents; Notify stays Cursor", async () => {
  const { mergeColumns, mergeTeamConfig } = await import("./team-config.ts");
  const merged = mergeColumns(
    COLUMNS.map((c) => {
      if (c.id === PREP_AGENDA_COLUMN_ID) return { ...c, agent: "webllm" as const, cli: undefined, webllmProfile: "fast" };
      if (c.id === SYNTHESIZE_COLUMN_ID) return { ...c, agent: "studio" as const, cli: undefined, webllmProfile: undefined };
      if (c.id === SEND_SLACK_COLUMN_ID) return { ...c, agent: "webllm" as const };
      return c;
    }),
  );
  const agenda = merged.find((c) => c.id === PREP_AGENDA_COLUMN_ID);
  const spec = merged.find((c) => c.id === SYNTHESIZE_COLUMN_ID);
  const notify = merged.find((c) => c.id === SEND_SLACK_COLUMN_ID);
  assert.equal(agenda?.agent, "cursor");
  assert.equal(agenda?.cli, "print");
  assert.equal(spec?.agent, "cursor");
  assert.equal(spec?.cli, "print");
  assert.equal(notify?.agent, "cursor");

  const hydrated = mergeTeamConfig({
    columns: [{ id: "custom-only", name: "Custom", label: "Custom", role: "prompt", rail: "run", enabled: true }],
    prompts: [{ id: `prompt-${PREP_AGENDA_COLUMN_ID}`, name: "Agenda", body: "stale session edit", skillIds: [], jiraKeys: [] }],
    flows: [{ id: "flow-session", name: "Session flow", description: "", columns: [], autoAdvance: false, autoRun: false }],
  });
  assert.equal(
    hydrated.columns.some((c) => c.id === "custom-only"),
    false,
  );
  assert.equal(
    hydrated.flows.some((f) => f.id === "flow-session"),
    false,
  );
  assert.match(hydrated.prompts.find((p) => p.id === `prompt-${PREP_AGENDA_COLUMN_ID}`)?.body ?? "", /Brief \(logistics\)/);
});

test("restoreSessionPipeline keeps pipeline edits for the current app process", async () => {
  const { restoreSessionPipeline, mergeTeamConfig } = await import("./team-config.ts");
  const session = restoreSessionPipeline({
    columns: [{ id: "custom-only", name: "Custom", label: "Custom", role: "prompt", rail: "run", enabled: true }],
    prompts: [{ id: "prompt-custom-only", name: "Custom", body: "session {{brief}}", skillIds: [], jiraKeys: [] }],
    flows: [
      {
        id: "flow-session",
        name: "Session flow",
        description: "",
        columns: [{ id: "custom-only", name: "Custom", label: "Custom", role: "prompt", rail: "run", enabled: true }],
        autoAdvance: false,
        autoRun: false,
      },
    ],
    activeFlowId: "flow-session",
  });
  assert.equal(session.activeFlowId, "flow-session");
  assert.equal(session.columns[0]?.id, "custom-only");
  assert.equal(session.prompts.find((p) => p.id === "prompt-custom-only")?.body, "session {{brief}}");

  const afterBoot = mergeTeamConfig(session);
  assert.equal(
    afterBoot.flows.some((f) => f.id === "flow-session"),
    false,
  );
  assert.equal(
    afterBoot.columns.some((c) => c.id === "custom-only"),
    false,
  );
});

test("restoreSessionPipeline fills missing cli from discovery JSON", async () => {
  const { restoreSessionPipeline } = await import("./team-config.ts");
  const columns = COLUMNS.map((c) =>
    c.id === PREP_AGENDA_COLUMN_ID || c.id === SYNTHESIZE_COLUMN_ID
      ? { ...c, agent: "webllm" as const, cli: undefined, webllmProfile: "fast" as const }
      : { ...c, cli: undefined },
  );
  const session = restoreSessionPipeline({
    flows: [
      {
        id: "flow-discovery",
        name: "Discovery",
        description: "",
        columns,
        autoAdvance: true,
        autoRun: false,
      },
    ],
    activeFlowId: "flow-discovery",
    columns,
  });
  assert.equal(session.columns.find((c) => c.id === SEND_SLACK_COLUMN_ID)?.cli, "tui");
  assert.equal(session.columns.find((c) => c.id === "write-plan")?.cli, "print");
  assert.equal(session.columns.find((c) => c.id === PREP_AGENDA_COLUMN_ID)?.cli, "print");
  assert.equal(session.columns.find((c) => c.id === PREP_AGENDA_COLUMN_ID)?.agent, "cursor");
  assert.equal(session.columns.find((c) => c.id === SYNTHESIZE_COLUMN_ID)?.agent, "cursor");
  assert.equal(session.columns.find((c) => c.id === SYNTHESIZE_COLUMN_ID)?.cli, "print");
});
