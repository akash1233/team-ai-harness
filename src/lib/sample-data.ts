import type { Ticket } from "./types.ts";
import { DISCOVERY_FLOW_ID, IDEATION_COLUMN_ID } from "./columns.ts";

function iso(h: number, m: number, s = 0) {
  return new Date(Date.UTC(2026, 7, 28, h + 4, m, s)).toISOString();
}

export type BriefDefaults = {
  slackChannel: string;
  slackChannelId: string;
};

export function createSampleTickets(): Ticket[] {
  const rows: Array<Omit<Ticket, "flowId" | "vars" | "linkedJiras"> & Partial<Pick<Ticket, "flowId" | "vars" | "linkedJiras">>> = [
    {
      id: "t-x2-698",
      key: "X2-698",
      title: "Add Prompts in Jira BDD Assistant - X2",
      description: "",
      labels: [],
      columnId: IDEATION_COLUMN_ID,
      status: "idle",
      spend: 0,
      runId: "",
      slackChannel: "",
      slackChannelId: "",
      slackMembers: "",
      ideationNotes: "",
      transcript: "",
      outputs: {},
      agentResponses: [],
      grillRounds: [],
      fryComplete: false,
      plan: null,
      jiraCreated: [],
      createdAt: iso(7, 58),
    },
  ];
  return rows.map((t) => ({
    ...t,
    flowId: t.flowId ?? DISCOVERY_FLOW_ID,
    vars: t.vars ?? {},
    linkedJiras: t.linkedJiras ?? [],
  }));
}

/**
 * Strips everything a run produced so Reset gives a clean slate. Slack channel/ID
 * re-seed from team setup; ticket identity (key, title, linked Jiras/repos) is kept.
 */
export function clearTicketHistory(
  ticket: Ticket,
  startColumnId: string,
  briefDefaults: BriefDefaults,
): Ticket {
  return {
    ...ticket,
    columnId: startColumnId,
    status: "idle",
    spend: 0,
    runId: "",
    slackChannel: briefDefaults.slackChannel,
    slackChannelId: briefDefaults.slackChannelId,
    slackMembers: "",
    ideationNotes: "",
    transcript: "",
    agentResponses: [],
    outputs: {},
    vars: {},
    grillRounds: [],
    fryComplete: false,
    plan: null,
    jiraCreated: [],
    slackPosted: undefined,
    liveLog: undefined,
    liveInput: undefined,
    sessionDir: undefined,
    blockedReason: undefined,
  };
}

export const STORAGE_KEY = "kindling-v1";
