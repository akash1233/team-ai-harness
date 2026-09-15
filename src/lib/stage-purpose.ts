import type { WorkflowColumn } from "./types.ts";
import { DONE_COLUMN_ID } from "./columns.ts";
import { outputVarName } from "./flow-context.ts";

/** What this stage produces — derived from role + output key, not last-run text. */
export function stagePurpose(column: Pick<WorkflowColumn, "id" | "role" | "outputKey" | "label" | "testMode">): string {
  const key = outputVarName(column as WorkflowColumn);
  const testing = column.testMode ? " Test this stage: seed or override inputs; the run stays here." : "";
  let body: string;
  switch (column.role) {
    case "collect-input":
      body = key ? `You add this. Later stages read {{${key}}}.` : "You add this for later stages.";
      break;
    case "prompt":
    case "plan":
      body = key ? `Agent writes {{${key}}}.` : "Agent writes the stage result.";
      break;
    case "review":
      body = key
        ? `Edit the previous stage output, then Approve to write {{${key}}}.`
        : "Edit the previous stage output, then Approve to continue.";
      break;
    case "approve":
      body = "Edit if needed, then Approve to continue.";
      break;
    case "terminal":
      body = column.id === DONE_COLUMN_ID ? "Finished work." : "Parked or blocked.";
      break;
    default:
      body = key ? `Writes {{${key}}}.` : column.label;
  }
  return `${body}${testing}`;
}

/** One-line peek for cards. Full body belongs in the ticket panel. */
export function previewLine(text: string, max = 88): string {
  const line = text
    .trim()
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}
