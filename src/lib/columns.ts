import discoveryFlowJson from "../../flows/discovery.flow.json" with { type: "json" };
import type { FlowSpec, FlowStageSpec } from "./flow-spec.ts";
import type { ColumnRole, RailTone, StepAgent, WebllmProfile, WorkflowColumn } from "./types";

export const IDEATION_COLUMN_ID = "ideation";
export const PREP_AGENDA_COLUMN_ID = "prep-agenda";
export const PREVIEW_AGENDA_COLUMN_ID = "preview-agenda";
export const SEND_SLACK_COLUMN_ID = "send-slack";
export const TRANSCRIPT_COLUMN_ID = "transcript";
export const SYNTHESIZE_COLUMN_ID = "synthesize";
export const PREVIEW_SYNTHESIZE_COLUMN_ID = "preview-synthesize";
export const FRY_COLUMN_ID = "fry";
export const PREVIEW_FRY_COLUMN_ID = "preview-fry";
export const WRITE_PLAN_COLUMN_ID = "write-plan";
export const APPROVE_COLUMN_ID = "approve";
export const FILE_JIRA_COLUMN_ID = "file-jira";
export const DONE_COLUMN_ID = "done";
export const BLOCKED_COLUMN_ID = "blocked";

export const PLAN_JSON_START = "<<<PLAN_JSON";
export const PLAN_JSON_END = "PLAN_JSON>>>";

export const NOTIFY_PROMPT_TEMPLATE = `Post the approved agenda to Slack using the slack-mcp slack_write tool.

Call slack_write with method chat.postMessage and params channel + text (see below).
Approve the slack_write tool call when Cursor prompts — the post will not run until you approve.

Channel ID: {{slackChannelId}}
Channel: #{{slackChannel}}

Post this message verbatim — do not rewrite:

{{slackMessage}}`;

const COLUMN_ROLES: ColumnRole[] = ["collect-input", "prompt", "review", "plan", "approve", "terminal"];
const AGENT_VALUES = ["manual", "cursor", "claude", "studio", "cis", "webllm"] as const;
const WEBLLM_PROFILES: WebllmProfile[] = ["fast", "balanced", "quality"];

function isColumnRole(role: string): role is ColumnRole {
  return (COLUMN_ROLES as string[]).includes(role);
}

function railFor(role: ColumnRole): RailTone {
  if (role === "review") return "review";
  if (role === "plan" || role === "approve" || role === "terminal") return "gate";
  return "run";
}

function stagePromptBody(stage: FlowStageSpec): string | undefined {
  const parts = [stage.prompt?.system, stage.prompt?.user].filter((part) => part?.trim());
  return parts.length ? parts.join("\n\n") : undefined;
}

function stageAgent(stage: FlowStageSpec): StepAgent | undefined {
  const agent = stage.agent;
  if (agent && (AGENT_VALUES as readonly string[]).includes(agent)) return agent as StepAgent;
  return undefined;
}

function stageOutputKey(stage: FlowStageSpec): string | undefined {
  return stage.writes?.find((key) => key !== "prev");
}

/** Board columns for a flow spec. JSON stages are the list — nothing is appended. */
export function columnsFromFlowSpec(flow: FlowSpec): WorkflowColumn[] {
  return flow.stages.map((stage) => {
    const role = isColumnRole(stage.role) ? stage.role : "prompt";
    const profile = WEBLLM_PROFILES.find((id) => id === stage.webllmProfile);
    return {
      id: stage.id,
      name: stage.label,
      label: stage.label,
      role,
      rail: railFor(role),
      enabled: true,
      agent: stageAgent(stage),
      webllmProfile: profile,
      outputKey: stageOutputKey(stage),
      promptTemplate: stagePromptBody(stage),
    };
  });
}

/** Discovery board. Source of truth: flows/discovery.flow.json — no extra locked columns. */
export const COLUMNS: WorkflowColumn[] = columnsFromFlowSpec(discoveryFlowJson as FlowSpec);

export function columnById(
  id: string,
  columns: WorkflowColumn[] = COLUMNS,
): WorkflowColumn | undefined {
  return columns.find((c) => c.id === id);
}

/** First enabled collect-input, else the first enabled stage — tickets always have a home. */
export function startColumnId(columns: WorkflowColumn[]): string {
  const enabled = columns.filter((c) => c.enabled);
  return (
    enabled.find((c) => c.role === "collect-input")?.id ||
    enabled[0]?.id ||
    columns[0]?.id ||
    IDEATION_COLUMN_ID
  );
}

export function resolveActiveStage(columns: WorkflowColumn[], current?: string): string {
  if (current && columns.some((c) => c.id === current)) return current;
  return startColumnId(columns);
}

export function parkOrphanTickets<T extends { columnId: string }>(tickets: T[], columns: WorkflowColumn[]): T[] {
  const ids = new Set(columns.map((c) => c.id));
  const start = startColumnId(columns);
  return tickets.map((t) => (ids.has(t.columnId) ? t : { ...t, columnId: start }));
}

export function nextColumnId(
  columnId: string,
  columns: WorkflowColumn[] = COLUMNS,
): string | null {
  const i = columns.findIndex((c) => c.id === columnId);
  if (i < 0) return null;
  for (let j = i + 1; j < columns.length; j++) {
    const col = columns[j];
    if (col?.enabled) return col.id;
  }
  return null;
}

/** Previous enabled stage — review gates edit this stage's output. */
export function previousColumn(
  columnId: string,
  columns: WorkflowColumn[] = COLUMNS,
): WorkflowColumn | undefined {
  const i = columns.findIndex((c) => c.id === columnId);
  if (i < 0) return undefined;
  for (let j = i - 1; j >= 0; j--) {
    const col = columns[j];
    if (col?.enabled) return col;
  }
  return undefined;
}

export const PIPELINE_IDS = COLUMNS.map((c) => c.id);

export const DISCOVERY_FLOW_ID = "flow-discovery";
export const QUICK_SPEC_FLOW_ID = "flow-quick-spec";

export function cloneColumns(ids?: string[]): WorkflowColumn[] {
  if (!ids) return COLUMNS.map((c) => ({ ...c }));
  return ids
    .map((id) => COLUMNS.find((c) => c.id === id))
    .filter((c): c is WorkflowColumn => Boolean(c))
    .map((c) => ({ ...c }));
}
