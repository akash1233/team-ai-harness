import type { Ticket, WorkflowColumn } from "./types.ts";
import { DISCOVERY_FLOW_ID, FRY_COLUMN_ID, IDEATION_COLUMN_ID, WRITE_PLAN_COLUMN_ID } from "./columns.ts";
import { outputVarName } from "./flow-context.ts";

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

/** Drop this stage's last result so a new run does not show stale output. */
export function beginStageRun(
  ticket: Ticket,
  column: Pick<WorkflowColumn, "id" | "outputKey">,
  opts?: { loadingText?: string; keepGrillRounds?: boolean },
): Ticket {
  const key = outputVarName(column);
  const oldBody = ticket.outputs[column.id] || (key ? ticket.vars?.[key] : undefined) || ticket.liveLog;
  const outputs = { ...ticket.outputs };
  delete outputs[column.id];
  const vars = { ...ticket.vars };
  delete vars[column.id];
  if (key) delete vars[key];
  if (oldBody && vars.prev === oldBody) delete vars.prev;
  return {
    ...ticket,
    status: "executing",
    blockedReason: undefined,
    liveLog: opts?.loadingText ?? "",
    liveInput: undefined,
    sessionDir: undefined,
    outputs,
    vars,
    fryComplete: column.id === FRY_COLUMN_ID ? false : ticket.fryComplete,
    grillRounds: column.id === FRY_COLUMN_ID && !opts?.keepGrillRounds ? [] : ticket.grillRounds,
    plan: column.id === WRITE_PLAN_COLUMN_ID ? null : ticket.plan,
  };
}
