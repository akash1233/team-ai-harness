import {
  FILE_JIRA_COLUMN_ID,
  FRY_COLUMN_ID,
  IDEATION_COLUMN_ID,
  isFryStage,
  migrateColumnId,
  previousColumn,
  SEND_SLACK_COLUMN_ID,
  TRANSCRIPT_COLUMN_ID,
} from "./columns.ts";
import { formatFiledJiraDisplay, jiraProjectFromKey } from "./discovery-jira.ts";
import { composeSlackMessage, normalizeSlackChannelName, resolveAgendaDocument } from "./discovery-slack.ts";
import { formatFryRecord, fryQuestionVars, isFryVarKey, stripFryVars } from "./grill.ts";
import type { JiraIssue, TeamDoc, Ticket, WorkflowColumn } from "./types";

const TOKEN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function mentionedKeys(template: string | undefined): string[] {
  if (!template) return [];
  const keys: string[] = [];
  for (const match of template.matchAll(TOKEN)) {
    const key = match[1];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(TOKEN, (_, key: string) => ctx[key] ?? "");
}

export function outputVarName(column: { id?: string; outputKey?: string } | undefined): string {
  if (!column) return "";
  const key = column.outputKey?.trim();
  if (key) return key;
  return (column.id ?? "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Keep pre-rename Fry Me tokens populated so old prompts still interpolate. */
export function applyFryAliases(vars: Record<string, string>, body: string): Record<string, string> {
  const text = body.trim();
  if (!text) return vars;
  vars.fryme = text;
  vars.grill = text;
  vars.fyyme = text;
  vars.fry = text;
  return vars;
}

/** Persist the full Q&A record plus per-question vars for later stages. */
export function harvestFryVars(ticket: Ticket): Record<string, string> {
  const vars = stripFryVars(ticket.vars ?? {});
  const record = formatFryRecord(ticket);
  if (record) {
    applyFryAliases(vars, record);
    vars.prev = record;
  }
  Object.assign(vars, fryQuestionVars(ticket));
  return vars;
}

export function harvestVars(
  ticket: Ticket,
  column: WorkflowColumn | undefined,
  text: string,
): Record<string, string> {
  const vars = { ...ticket.vars };
  const body = text.trim();
  if (!body || !column) return vars;
  const name = outputVarName(column);
  const canonicalId = migrateColumnId(column.id);
  vars[column.id] = body;
  vars[canonicalId] = body;
  if (name) vars[name] = body;
  if (isFryStage(column.id) || name === "fryme" || name === "grill") {
    applyFryAliases(vars, body);
    Object.assign(vars, fryQuestionVars(ticket));
  }
  vars.prev = body;
  return vars;
}

/** Previous stage body a review gate shows (and can edit) before Approve. */
export function reviewSourceText(
  ticket: Ticket,
  reviewColumn: WorkflowColumn | undefined,
  columns: WorkflowColumn[],
): string {
  if (!reviewColumn) return "";
  const source = previousColumn(reviewColumn.id, columns);
  if (source) {
    if (isFryStage(source.id) || source.outputKey === "fryme" || source.outputKey === "grill") {
      const fryme =
        formatFryRecord(ticket) ||
        ticket.outputs[FRY_COLUMN_ID] ||
        ticket.outputs[source.id] ||
        ticket.outputs.fry ||
        ticket.vars?.fryme ||
        ticket.vars?.grill ||
        "";
      if (fryme.trim()) return fryme.trim();
    }
    if ((source.role === "plan" || source.outputKey === "plan") && ticket.plan) {
      return JSON.stringify(ticket.plan, null, 2);
    }
    const key = outputVarName(source);
    const fromSource =
      (key && ticket.vars?.[key]) || ticket.outputs[source.id] || ticket.vars?.prev || "";
    if (fromSource.trim()) return fromSource.trim();
  }
  const reviewKey = outputVarName(reviewColumn);
  return (
    ticket.outputs[reviewColumn.id] ||
    (reviewKey && ticket.vars?.[reviewKey]) ||
    ticket.vars?.prev ||
    ""
  ).trim();
}

/** Approve harvests the (possibly edited) previous body into review + source vars. */
export function harvestReviewVars(
  ticket: Ticket,
  reviewColumn: WorkflowColumn,
  sourceColumn: WorkflowColumn | undefined,
  text: string,
): Record<string, string> {
  const body = text.trim();
  const vars = harvestVars(ticket, reviewColumn, body);
  if (!body || !sourceColumn) return vars;
  const sourceKey = outputVarName(sourceColumn);
  vars[sourceColumn.id] = body;
  vars[migrateColumnId(sourceColumn.id)] = body;
  if (sourceKey) vars[sourceKey] = body;
  if (isFryStage(sourceColumn.id) || sourceKey === "fryme" || sourceKey === "grill") {
    applyFryAliases(vars, body);
    Object.assign(vars, fryQuestionVars(ticket));
  }
  return vars;
}

function slackChannelFromTicket(ticket: Ticket): string {
  return normalizeSlackChannelName(ticket.vars?.slackChannel || ticket.slackChannel);
}

function slackChannelIdFromTicket(ticket: Ticket): string {
  return (ticket.vars?.slackChannelId || ticket.slackChannelId).trim();
}

/** Publishes Brief stage tokens for downstream Notify and prompts. */
export function harvestBriefVars(ticket: Ticket, outputText: string): Record<string, string> {
  const body = outputText.trim();
  const channel = slackChannelFromTicket(ticket);
  const channelId = slackChannelIdFromTicket(ticket);
  const members = (ticket.vars?.["slack.members"] || ticket.slackMembers).trim();
  return {
    ...ticket.vars,
    [IDEATION_COLUMN_ID]: body,
    brief: body,
    slackChannel: channel,
    slackChannelId: channelId,
    "slack.channel": channel,
    "slack.members": members,
    prev: body,
  };
}

/** Pre-sync Notify inputs when the ticket enters the send-slack stage. */
export function syncNotifyPreviewVars(ticket: Ticket): Record<string, string> {
  const agenda = resolveAgendaDocument(ticket);
  const channel = slackChannelFromTicket(ticket);
  const channelId = slackChannelIdFromTicket(ticket);
  const slackMessage = composeSlackMessage(ticket, agenda);
  return {
    ...ticket.vars,
    ...(agenda ? { agenda } : {}),
    slackChannel: channel,
    slackChannelId: channelId,
    "slack.channel": channel,
    ...(slackMessage ? { slackMessage } : {}),
  };
}

/** Records a successful slack-mcp post into pipeline vars. */
export function harvestNotifyVars(
  ticket: Ticket,
  column: WorkflowColumn | undefined,
  post: { channel: string; channelId: string; ts: string },
  messageText: string,
): Record<string, string> {
  const summary = `Posted to #${post.channel} (${post.channelId}) ts=${post.ts}`;
  const body = messageText.trim();
  const base = harvestVars(ticket, column, summary);
  const channel = normalizeSlackChannelName(post.channel);
  return {
    ...base,
    [SEND_SLACK_COLUMN_ID]: summary,
    slack_post: summary,
    slackMessage: body,
    slackChannel: channel,
    slackChannelId: post.channelId,
    "slack.channel": channel,
    "slack.ts": post.ts,
    prev: summary,
  };
}

/** Records created epics/stories after a jira-ghe File Jira harvest. */
export function harvestFileJiraVars(
  ticket: Ticket,
  column: WorkflowColumn | undefined,
  issues: JiraIssue[],
  display: string,
): Record<string, string> {
  const body = (issues.length ? formatFiledJiraDisplay(issues) : display).trim();
  const base = harvestVars(ticket, column, body || display);
  return {
    ...base,
    [FILE_JIRA_COLUMN_ID]: body,
    jira_filed: body,
    prev: body,
  };
}

/** Text a human stage publishes when runTicket captures without an agent. */
export function readManualOutput(ticket: Ticket, column: WorkflowColumn): string {
  if (column.id === IDEATION_COLUMN_ID) {
    const channel = ticket.slackChannel.trim();
    const members = ticket.slackMembers.trim();
    return [
      channel ? `Slack channel: #${channel.replace(/^#+/, "")}` : "",
      ticket.slackChannelId ? `Channel ID: ${ticket.slackChannelId}` : "",
      members ? `Team members: ${members}` : "",
      ticket.ideationNotes ? `Notes: ${ticket.ideationNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (column.id === TRANSCRIPT_COLUMN_ID) {
    return ticket.transcript.trim();
  }
  const variable = outputVarName(column);
  return (
    (variable && ticket.vars?.[variable]) ||
    ticket.outputs[column.id] ||
    ticket.vars?.input ||
    ""
  ).trim();
}

export type TeamContextDefaults = {
  jiraComponents?: string;
};

export function buildContext(ticket: Ticket, docs?: TeamDoc[], team?: TeamContextDefaults): Record<string, string> {
  const fryme = formatFryRecord(ticket);
  const jiras = ticket.linkedJiras ?? [];
  const ctx: Record<string, string> = {
    "ticket.key": ticket.key,
    "ticket.title": ticket.title,
    "ticket.description": ticket.description,
    "ticket.labels": ticket.labels.join(", "),
    "slack.channel": slackChannelFromTicket(ticket),
    "slack.members": ticket.vars?.["slack.members"] || ticket.slackMembers,
    brief: "",
    agenda: "",
    transcript: "",
    spec: "",
    fryme: "",
    grill: "",
    fyyme: "",
    fry: "",
    plan: "",
    jiraProject: "",
    jiraComponents: "",
    jira_filed: "",
    jira: "",
    repo: "",
    input: ticket.vars?.input ?? "",
    prev: "",
    ...ticket.outputs,
    ...ticket.vars,
    ...(ticket.stageTestVars ?? {}),
  };

  ctx.brief =
    ctx.brief ||
    ticket.outputs.ideation ||
    [
      ticket.slackChannel ? `Slack channel: #${ticket.slackChannel.replace(/^#+/, "")}` : "",
      ticket.slackMembers ? `Team members: ${ticket.slackMembers}` : "",
      ticket.ideationNotes,
    ]
      .filter(Boolean)
      .join("\n");
  const agendaDoc = resolveAgendaDocument(ticket);
  ctx.agenda = ctx.agenda || agendaDoc || ticket.outputs["prep-agenda"] || "";
  ctx.slackChannel = ctx.slackChannel || slackChannelFromTicket(ticket);
  ctx.slackChannelId = ctx.slackChannelId || slackChannelIdFromTicket(ticket);
  ctx.slackMessage = ctx.slackMessage || composeSlackMessage(ticket, agendaDoc) || "";
  ctx.transcript = ctx.transcript || ticket.transcript || ticket.outputs.transcript || "";
  ctx.spec = ctx.spec || ticket.outputs.synthesize || "";
  ctx.fryme =
    fryme ||
    ctx.fryme ||
    ctx.grill ||
    ctx.fyyme ||
    ctx.fry ||
    ticket.outputs[FRY_COLUMN_ID] ||
    ticket.outputs.fry ||
    "";
  ctx.grill = ctx.fryme;
  ctx.fyyme = ctx.fryme;
  ctx.fry = ctx.fryme;
  Object.assign(ctx, fryQuestionVars(ticket));
  ctx.plan =
    ctx.plan ||
    (ticket.plan ? JSON.stringify(ticket.plan, null, 2) : "") ||
    ticket.outputs["write-plan"] ||
    "";
  ctx.jiraProject = ctx.jiraProject || jiraProjectFromKey(ticket.key);
  ctx.jiraComponents = ctx.jiraComponents || team?.jiraComponents?.trim() || "";
  ctx.jira_filed =
    ctx.jira_filed ||
    ticket.outputs[FILE_JIRA_COLUMN_ID] ||
    (ticket.jiraCreated.length ? formatFiledJiraDisplay(ticket.jiraCreated) : "");
  ctx.jira = jiras.length
    ? jiras.map((issue) => `${issue.key} ${issue.title}\n${issue.description}`.trim()).join("\n\n")
    : ticket.jiraCreated.map((j) => `${j.key} ${j.title}`).join("\n") ||
      ticket.outputs["file-jira"] ||
      "";
  const firstJira = jiras[0];
  if (firstJira) {
    ctx["jira.key"] = firstJira.key;
    ctx["jira.title"] = firstJira.title;
    ctx["jira.status"] = firstJira.status;
    ctx["jira.url"] = firstJira.url;
    ctx["jira.description"] = firstJira.description;
  } else {
    ctx["jira.key"] = "";
    ctx["jira.title"] = "";
    ctx["jira.status"] = "";
    ctx["jira.url"] = "";
    ctx["jira.description"] = "";
  }
  for (const issue of jiras) {
    const prefix = `jira.${issue.key}`;
    ctx[prefix] = `${issue.key} ${issue.title}\n${issue.description}`.trim();
    ctx[`${prefix}.key`] = issue.key;
    ctx[`${prefix}.title`] = issue.title;
    ctx[`${prefix}.status`] = issue.status;
    ctx[`${prefix}.url`] = issue.url;
    ctx[`${prefix}.description`] = issue.description;
  }
  if (ticket.linkedRepo) {
    ctx.repo = ticket.linkedRepo.fullName;
    ctx["repo.fullName"] = ticket.linkedRepo.fullName;
    ctx["repo.url"] = ticket.linkedRepo.url;
    ctx["repo.branch"] = ticket.linkedRepo.defaultBranch;
    ctx["repo.description"] = ticket.linkedRepo.description;
  }
  ctx.prev = ctx.prev || "";
  if (ticket.stageTestVars) Object.assign(ctx, ticket.stageTestVars);

  if (docs?.length) {
    ctx.docs = docs.map((d) => `### ${d.title} (${d.kind})\n${d.body}`).join("\n\n");
  }

  const skip = new Set(["context", "docs"]);
  const seen = new Set<string>();
  ctx.context = Object.entries(ctx)
    .filter(([k, v]) => {
      const body = v.trim();
      if (
        !body ||
        skip.has(k) ||
        k.startsWith("ticket.") ||
        (isFryVarKey(k) && k !== "fryme") ||
        (k.startsWith("jira.") && k !== "jira")
      ) {
        return false;
      }
      if (seen.has(body)) return false;
      seen.add(body);
      return true;
    })
    .map(([k, v]) => `## ${k}\n${v}`)
    .join("\n\n");

  return ctx;
}

const MAX_UPSTREAM_SECTION_CHARS = 6000;

function upstreamSection(label: string, value: string): string {
  const body = value.trim();
  const text =
    body.length > MAX_UPSTREAM_SECTION_CHARS
      ? `${body.slice(0, MAX_UPSTREAM_SECTION_CHARS)}\n…truncated`
      : body;
  return `## ${label}\n${text}`;
}

/**
 * Builds the complete, ordered payload available before the current stage.
 * Disabled columns are still represented when they produced data earlier, and
 * named variables that do not map to a column are retained at the end.
 */
export function buildUpstream(
  ticket: Ticket,
  columns: WorkflowColumn[],
  currentColumnId: string,
  alreadyIncluded = "",
): string {
  const currentIndex = columns.findIndex((column) => column.id === currentColumnId);
  const prior = currentIndex < 0 ? columns : columns.slice(0, currentIndex);
  const seen = new Set<string>();
  const sections: string[] = [];

  const add = (label: string, raw: string | undefined) => {
    const value = raw?.trim();
    if (!value || seen.has(value) || alreadyIncluded.includes(value)) return;
    seen.add(value);
    sections.push(upstreamSection(label, value));
  };

  add("Ticket", `Jira ${ticket.key}: ${ticket.title}\n${ticket.description}\nLabels: ${ticket.labels.join(", ")}`);
  for (const column of prior) {
    const variable = outputVarName(column);
    add(
      `${column.label || column.name}${variable ? ` ({{${variable}}})` : ""}`,
      ticket.vars?.[variable] || ticket.vars?.[column.id] || ticket.outputs[column.id],
    );
  }

  for (const [key, value] of Object.entries(ticket.vars ?? {})) {
    if (key === "prev") continue;
    add(`Variable {{${key}}}`, value);
  }

  const context = buildContext(ticket);
  add("Transcript", ticket.transcript);
  add("Jira", context.jira);
  add("Repository", context.repo);
  return sections.join("\n\n");
}
