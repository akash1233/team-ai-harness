import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  composeSlackMessage,
  extractNotifyMcpResult,
  normalizeSlackChannelName,
  resolveAgendaDocument,
  resolveSlackPostParams,
  resolveSlackMessage,
} from "./discovery-slack.ts";
import type { Ticket } from "./types.ts";

function ticket(partial: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    key: "KIN-1",
    title: "Spend meter",
    description: "",
    labels: [],
    columnId: "send-slack",
    flowId: "discovery",
    status: "idle",
    spend: 0,
    runId: "r1",
    linkedJiras: [],
    outputs: {},
    vars: {},
    agentResponses: [],
    grillRounds: [],
    jiraCreated: [],
    fryComplete: false,
    plan: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    slackChannel: "",
    slackChannelId: "",
    slackMembers: "",
    transcript: "",
    ideationNotes: "",
    ...partial,
  };
}

test("resolveAgendaDocument prefers harvested vars.agenda", () => {
  const t = ticket({
    vars: { agenda: "From var" },
    outputs: { "prep-agenda": "From output" },
  });
  assert.equal(resolveAgendaDocument(t), "From var");
});

test("resolveAgendaDocument prefers approved-agenda after review", () => {
  const t = ticket({
    vars: { agenda: "From agenda run", "approved-agenda": "Edited in review" },
    outputs: { "prep-agenda": "From output" },
  });
  assert.equal(resolveAgendaDocument(t), "Edited in review");
});

test("composeSlackMessage adds Jira header and full agenda body", () => {
  const t = ticket({ linkedJiras: [{ key: "X2-99", title: "Epic", description: "", status: "", url: "" }] });
  const body = composeSlackMessage(t, "1. Goals\n2. Users");
  assert.match(body, /X2-99/);
  assert.match(body, /Spend meter/);
  assert.match(body, /1\. Goals/);
});

test("resolveSlackPostParams blocks without channel id or message", () => {
  assert.deepEqual(resolveSlackPostParams(ticket()), { blocked: "no Slack channel in Brief — set channel name or ID" });
  const noId = resolveSlackPostParams(ticket({ slackChannel: "dx" }));
  assert.equal("blocked" in noId && noId.blocked, "no Slack channel ID — Enterprise Grid requires a channel ID (C…)");
  const noAgenda = resolveSlackPostParams(ticket({ slackChannel: "dx", slackChannelId: "C1" }));
  assert.equal("blocked" in noAgenda && noAgenda.blocked, "no approved agenda to post — complete Agenda first");
});

test("resolveSlackPostParams returns channel and composed text", () => {
  const t = ticket({
    slackChannel: "#dx",
    slackChannelId: "C123",
    vars: { agenda: "Agenda body" },
  });
  const post = resolveSlackPostParams(t);
  assert.equal("blocked" in post, false);
  if ("blocked" in post) return;
  assert.equal(post.channelName, "dx");
  assert.equal(post.channelId, "C123");
  assert.match(post.text, /Agenda body/);
  assert.equal(resolveSlackMessage(t), post.text);
});

test("normalizeSlackChannelName strips hash", () => {
  assert.equal(normalizeSlackChannelName("##team-channel"), "team-channel");
});

test("extractNotifyMcpResult parses posted method result JSON", () => {
  const log = `agent run
posted method chat.postMessage result: {"ok":true,"channel":"C0BQMKFR519","ts":"1725148800.123456"}
done`;
  const hit = extractNotifyMcpResult(log);
  assert.equal(hit.found, true);
  assert.match(hit.display, /slack_write\(chat\.postMessage\)/);
  assert.match(hit.display, /C0BQMKFR519/);
  assert.equal(hit.ts, "1725148800.123456");
  assert.equal(hit.channelId, "C0BQMKFR519");
});

test("extractNotifyMcpResult finds agent prose without JSON", () => {
  const hit = extractNotifyMcpResult("Some TUI noise\nPosted to #get-dx-insights-test successfully\n");
  assert.equal(hit.found, true);
  assert.match(hit.display, /get-dx-insights-test/i);
});

test("extractNotifyMcpResult returns not found for noise-only log", () => {
  const hit = extractNotifyMcpResult("[kindling] starting\ncursor-retrieval: tracing\n");
  assert.equal(hit.found, false);
  assert.equal(hit.display, "");
});
