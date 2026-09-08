import {
  FRY_COLUMN_ID,
  FRY_DOC_ID,
  LEGACY_FRY_COLUMN_ID,
  LEGACY_FRY_DOC_ID,
  LEGACY_PREVIEW_FRY_COLUMN_ID,
  migrateColumnId,
  PREVIEW_FRY_COLUMN_ID,
} from "./columns.ts";
import type { FryRound, Ticket, WorkflowColumn } from "./types.ts";

/** Saved tickets used grill* names and stage id `fry`. Map them on hydrate. */
export type LegacyTicket = Ticket & {
  grillRounds?: FryRound[];
};

export function migrateDocId(id: string): string {
  return id === LEGACY_FRY_DOC_ID ? FRY_DOC_ID : id;
}

export function migratePromptId(id: string): string {
  if (id === `prompt-${LEGACY_FRY_COLUMN_ID}`) return `prompt-${FRY_COLUMN_ID}`;
  if (id === `prompt-${LEGACY_PREVIEW_FRY_COLUMN_ID}`) return `prompt-${PREVIEW_FRY_COLUMN_ID}`;
  return id;
}

export function migrateSavedColumn(column: WorkflowColumn): WorkflowColumn {
  const id = migrateColumnId(column.id);
  return {
    ...column,
    id,
    outputKey: column.outputKey === "grill" ? "fryme" : column.outputKey,
    promptRef: column.promptRef ? migratePromptId(column.promptRef) : column.promptRef,
  };
}

function copyIfEmpty(record: Record<string, string>, to: string, from: string) {
  if (!record[to]?.trim() && record[from]?.trim()) record[to] = record[from]!;
}

export function migrateTicketFry(ticket: LegacyTicket): Ticket {
  const vars = { ...ticket.vars };
  copyIfEmpty(vars, "fryme", "grill");
  copyIfEmpty(vars, "fryme", "fry");
  copyIfEmpty(vars, "fryme", "fyyme");
  copyIfEmpty(vars, PREVIEW_FRY_COLUMN_ID, LEGACY_PREVIEW_FRY_COLUMN_ID);
  if (vars.fryme?.trim()) {
    copyIfEmpty(vars, "grill", "fryme");
    copyIfEmpty(vars, "fyyme", "fryme");
    copyIfEmpty(vars, "fry", "fryme");
  }
  const outputs = { ...ticket.outputs };
  copyIfEmpty(outputs, FRY_COLUMN_ID, LEGACY_FRY_COLUMN_ID);
  copyIfEmpty(outputs, PREVIEW_FRY_COLUMN_ID, LEGACY_PREVIEW_FRY_COLUMN_ID);
  const fryRounds = ticket.fryRounds?.length ? ticket.fryRounds : ticket.grillRounds ?? [];
  return {
    ...ticket,
    columnId: migrateColumnId(ticket.columnId),
    vars,
    outputs,
    fryRounds,
    agentResponses: (ticket.agentResponses ?? []).map((r) => ({
      ...r,
      columnId: migrateColumnId(r.columnId),
    })),
  };
}
