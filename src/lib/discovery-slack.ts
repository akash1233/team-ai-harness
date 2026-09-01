import { PREP_AGENDA_COLUMN_ID } from "./columns.ts";
import type { Ticket } from "./types.ts";

export type SlackPostParams = {
  channelName: string;
  channelId: string;
  text: string;
};

export type SlackPostBlocked = { blocked: string };

export type NotifyMcpExtract = {
  found: boolean;
  display: string;
  ts?: string;
  channelId?: string;
};

function stripLogNoise(text: string): string {
  return text
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function extractJsonObject(text: string, startIdx: number): string | null {
  if (text[startIdx] !== "{") return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

function findSlackOkJson(plain: string): Record<string, unknown> | null {
  const marker = /"ok"\s*:\s*true/i.exec(plain);
  if (!marker) return null;
  let start = plain.lastIndexOf("{", marker.index);
  while (start >= 0) {
    const chunk = extractJsonObject(plain, start);
    if (chunk) {
      try {
        const obj = JSON.parse(chunk) as Record<string, unknown>;
        if (obj.ok === true) return obj;
      } catch {
        /* try an earlier object */
      }
    }
    start = plain.lastIndexOf("{", start - 1);
  }
  return null;
}

function formatMcpDisplay(method: string, data: Record<string, unknown>): NotifyMcpExtract {
  const channelId = typeof data.channel === "string" ? data.channel : undefined;
  const ts =
    typeof data.ts === "string" || typeof data.ts === "number" ? String(data.ts) : undefined;
  const lines = [method];
  if (channelId) lines.push(`channel: ${channelId}`);
  lines.push(`ok: ${data.ok === true}`);
  if (ts) lines.push(`ts: ${ts}`);
  return { found: true, display: lines.join("\n"), ts, channelId };
}

function snippetAround(plain: string, index: number, radius = 240): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(plain.length, index + radius);
  return plain
    .slice(start, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\[kindling\]/i.test(l))
    .join("\n")
    .trim();
}

/** Pull a clean MCP result block from a Notify Terminal log for Run log output. */
export function extractNotifyMcpResult(log: string): NotifyMcpExtract {
  const plain = stripLogNoise(log);
  if (!plain.trim()) return { found: false, display: "" };

  const postedMethod = /posted.*method.*result/i.exec(plain);
  if (postedMethod) {
    const json = findSlackOkJson(plain.slice(postedMethod.index));
    if (json) return formatMcpDisplay("slack_write(chat.postMessage)", json);
    return {
      found: true,
      display: snippetAround(plain, postedMethod.index),
    };
  }

  if (/chat\.postmessage|slack_write/i.test(plain)) {
    const json = findSlackOkJson(plain);
    if (json) return formatMcpDisplay("slack_write(chat.postMessage)", json);
  }

  const postedLine = plain
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /posted to #/i.test(l));
  if (postedLine) {
    const json = findSlackOkJson(plain);
    if (json) return formatMcpDisplay("slack_write(chat.postMessage)", json);
    return { found: true, display: postedLine };
  }

  if (/message sent/i.test(plain)) {
    const hit = /message sent[^\n]*/i.exec(plain);
    return { found: true, display: hit?.[0]?.trim() || "message sent" };
  }

  return { found: false, display: "" };
}

/** Approved agenda document from harvested var or stage output. */
export function resolveAgendaDocument(ticket: Ticket): string {
  return (ticket.vars?.agenda || ticket.outputs[PREP_AGENDA_COLUMN_ID] || "").trim();
}

/** Compose the Slack post body: optional Jira/ticket header + full agenda. */
export function composeSlackMessage(ticket: Ticket, agenda: string): string {
  const body = agenda.trim();
  if (!body) return "";
  const jiraKey = ticket.linkedJiras?.[0]?.key?.trim();
  const title = ticket.title?.trim();
  const header =
    jiraKey && title
      ? `Team discussion agenda for ${jiraKey}: ${title}`
      : jiraKey
        ? `Team discussion agenda for ${jiraKey}`
        : title
          ? `Team discussion agenda: ${title}`
          : "Team discussion agenda";
  return `${header}\n\n${body}`;
}

export function resolveSlackMessage(ticket: Ticket): string {
  const agenda = resolveAgendaDocument(ticket);
  if (!agenda) return "";
  return composeSlackMessage(ticket, agenda);
}

/** Channel name without leading #. */
export function normalizeSlackChannelName(channel: string | undefined): string {
  return (channel ?? "").replace(/^#+/, "").trim();
}

export function resolveSlackPostParams(ticket: Ticket, textOverride?: string): SlackPostParams | SlackPostBlocked {
  const channelName = normalizeSlackChannelName(ticket.slackChannel);
  const channelId = ticket.slackChannelId.trim();
  const text = (textOverride?.trim() || resolveSlackMessage(ticket)).trim();

  if (!channelName && !channelId) {
    return { blocked: "no Slack channel in Brief — set channel name or ID" };
  }
  if (!channelId) {
    return { blocked: "no Slack channel ID — Enterprise Grid requires a channel ID (C…)" };
  }
  if (!text) {
    return { blocked: "no approved agenda to post — complete Agenda first" };
  }

  return { channelName, channelId, text };
}
