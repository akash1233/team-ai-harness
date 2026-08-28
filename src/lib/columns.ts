import type { WorkflowColumn } from "./types";

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

export const COLUMNS: WorkflowColumn[] = [
  {
    id: IDEATION_COLUMN_ID,
    name: "Ideation",
    label: "Brief",
    role: "collect-input",
    rail: "run",
    enabled: true,
    promptTemplate:
      "Who to notify for the meeting agenda. Slack channel (single #) and/or team members.",
  },
  {
    id: PREP_AGENDA_COLUMN_ID,
    name: "Prep Agenda",
    label: "Agenda",
    role: "prompt",
    rail: "run",
    enabled: true,
    agent: "cursor",
    promptTemplate: `Write a Team Discussion Agenda with exactly these sections:
1. Problem / Goals / Metrics
2. Users / Personas / Stories
3. Research (competitors / data)
4. Features / UI / API
5. Risks / Out of scope / Tech
6. Priorities
End with: Record the full meeting.
Do not send Slack. Do not create Jira issues. Agenda document only.`,
  },
  {
    id: PREVIEW_AGENDA_COLUMN_ID,
    name: "Preview Agenda",
    label: "Review agenda",
    role: "review",
    rail: "review",
    enabled: true,
  },
  {
    id: SEND_SLACK_COLUMN_ID,
    name: "Slack — Send Agenda",
    label: "Notify",
    role: "prompt",
    rail: "run",
    enabled: true,
    promptTemplate:
      "Post the approved meeting agenda to Slack. One action. Do not rewrite the message.",
  },
  {
    id: TRANSCRIPT_COLUMN_ID,
    name: "Transcript",
    label: "Notes",
    role: "collect-input",
    rail: "idle",
    enabled: true,
    promptTemplate: "Paste the meeting transcript or notes.",
  },
  {
    id: SYNTHESIZE_COLUMN_ID,
    name: "Synthesize",
    label: "Spec",
    role: "prompt",
    rail: "run",
    enabled: true,
    agent: "cursor",
    promptTemplate: `Turn ideation, the Jira issue, and the meeting transcript into a spec.
Cover: problem, solution, user stories, implementation decisions, testing decisions, out of scope.
Do not interview. Do not create Jira issues.`,
  },
  {
    id: PREVIEW_SYNTHESIZE_COLUMN_ID,
    name: "Preview Synthesize",
    label: "Review spec",
    role: "review",
    rail: "review",
    enabled: true,
  },
  {
    id: FRY_COLUMN_ID,
    name: "Fryme",
    label: "Grill",
    role: "prompt",
    rail: "run",
    enabled: true,
    agent: "claude",
    promptTemplate: `Interview relentlessly as a design tree against the Synthesize spec.
Each round, ask the whole frontier: numbered questions, each with a recommended answer.
The team answers. Wait for those answers before the next round.
When the frontier is empty, emit conclusions, remaining risks, and decisions Write plan must honor.`,
  },
  {
    id: PREVIEW_FRY_COLUMN_ID,
    name: "Preview Fryme",
    label: "Review grill",
    role: "review",
    rail: "review",
    enabled: true,
  },
  {
    id: WRITE_PLAN_COLUMN_ID,
    name: "Write plan",
    label: "Backlog",
    role: "plan",
    rail: "gate",
    enabled: true,
    agent: "claude",
    promptTemplate: `Turn the Jira problem, synthesis, and Fryme output into a Jira backlog plan: epics and stories only. No implementation.
Emit ${PLAN_JSON_START} … ${PLAN_JSON_END} with summary, findings, scope, outOfScope, risks, and steps (title like "Epic: …" or "Story: …").`,
  },
  {
    id: APPROVE_COLUMN_ID,
    name: "Approve",
    label: "Sign-off",
    role: "approve",
    rail: "gate",
    enabled: true,
  },
  {
    id: FILE_JIRA_COLUMN_ID,
    name: "File in Jira",
    label: "File",
    role: "prompt",
    rail: "run",
    enabled: true,
    promptTemplate:
      "Create Jira issues from the approved plan only. Honor epic/story hierarchy. Do not invent extra scope.",
  },
  {
    id: DONE_COLUMN_ID,
    name: "Done",
    label: "Done",
    role: "terminal",
    rail: "gate",
    enabled: true,
    locked: true,
  },
  {
    id: BLOCKED_COLUMN_ID,
    name: "Blocked",
    label: "Blocked",
    role: "terminal",
    rail: "blocked",
    enabled: true,
    locked: true,
  },
];

export function columnById(
  id: string,
  columns: WorkflowColumn[] = COLUMNS,
): WorkflowColumn | undefined {
  return columns.find((c) => c.id === id);
}

export function nextColumnId(
  columnId: string,
  columns: WorkflowColumn[] = COLUMNS,
): string | null {
  if (columnId === BLOCKED_COLUMN_ID) return null;
  const pipeline = columns.filter((c) => c.id !== BLOCKED_COLUMN_ID);
  const i = pipeline.findIndex((c) => c.id === columnId);
  if (i < 0) return DONE_COLUMN_ID;
  for (let j = i + 1; j < pipeline.length; j++) {
    const col = pipeline[j];
    if (col && (col.enabled || col.id === DONE_COLUMN_ID)) return col.id;
  }
  return DONE_COLUMN_ID;
}

export const PIPELINE_IDS = COLUMNS.filter((c) => c.id !== BLOCKED_COLUMN_ID).map(
  (c) => c.id,
);
