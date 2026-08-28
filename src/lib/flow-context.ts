import { formatGrillRecord } from "./grill.ts";
import type { TeamDoc, Ticket, WorkflowColumn } from "./types";

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

export function outputVarName(column: WorkflowColumn | undefined): string {
  if (!column) return "";
  const key = column.outputKey?.trim();
  if (key) return key;
  return column.id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
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
  vars[column.id] = body;
  if (name) vars[name] = body;
  vars.prev = body;
  return vars;
}

export function buildContext(ticket: Ticket, docs?: TeamDoc[]): Record<string, string> {
  const grill = formatGrillRecord(ticket);
  const ctx: Record<string, string> = {
    "ticket.key": ticket.key,
    "ticket.title": ticket.title,
    "ticket.description": ticket.description,
    "ticket.labels": ticket.labels.join(", "),
    "slack.channel": ticket.slackChannel.replace(/^#+/, ""),
    "slack.members": ticket.slackMembers,
    brief: "",
    agenda: "",
    transcript: "",
    spec: "",
    grill: "",
    plan: "",
    jira: "",
    prev: "",
    ...ticket.outputs,
    ...ticket.vars,
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
  ctx.agenda = ctx.agenda || ticket.outputs["prep-agenda"] || "";
  ctx.transcript = ticket.transcript || ctx.transcript || ticket.outputs.transcript || "";
  ctx.spec = ctx.spec || ticket.outputs.synthesize || "";
  ctx.grill = grill || ctx.grill || ticket.outputs.fry || "";
  ctx.plan =
    ctx.plan ||
    (ticket.plan ? JSON.stringify(ticket.plan, null, 2) : "") ||
    ticket.outputs["write-plan"] ||
    "";
  ctx.jira =
    ctx.jira ||
    ticket.jiraCreated.map((j) => `${j.key} ${j.title}`).join("\n") ||
    ticket.outputs["file-jira"] ||
    "";
  ctx.prev = ctx.prev || "";

  if (docs?.length) {
    ctx.docs = docs.map((d) => `### ${d.title} (${d.kind})\n${d.body}`).join("\n\n");
  }

  const skip = new Set(["context", "docs"]);
  ctx.context = Object.entries(ctx)
    .filter(([k, v]) => v.trim() && !skip.has(k) && !k.startsWith("ticket."))
    .map(([k, v]) => `## ${k}\n${v}`)
    .join("\n\n");

  return ctx;
}
