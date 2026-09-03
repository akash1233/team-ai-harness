import type { WorkflowColumn } from "./types.ts";
import { DONE_COLUMN_ID } from "./columns.ts";
import { outputVarName } from "./flow-context.ts";

/** What this stage produces — derived from role + output key, not last-run text. */
export function stagePurpose(column: Pick<WorkflowColumn, "id" | "role" | "outputKey" | "label">): string {
  const key = outputVarName(column as WorkflowColumn);
  switch (column.role) {
    case "collect-input":
      return key ? `You add this. Later stages read {{${key}}}.` : "You add this for later stages.";
    case "prompt":
    case "plan":
      return key ? `Agent writes {{${key}}}.` : "Agent writes the stage result.";
    case "review":
      return key
        ? `Edit the previous stage output, then Approve to write {{${key}}}.`
        : "Edit the previous stage output, then Approve to continue.";
    case "approve":
      return "Edit if needed, then Approve to continue.";
    case "terminal":
      return column.id === DONE_COLUMN_ID ? "Finished work." : "Parked or blocked.";
    default:
      return key ? `Writes {{${key}}}.` : column.label;
  }
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
