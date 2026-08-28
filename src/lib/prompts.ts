import type { TeamDoc, TeamPrompt, WorkflowColumn } from "./types";

const FRY_COLUMN_ID = "fry";

export function promptIdForColumn(columnId: string): string {
  return `prompt-${columnId}`;
}

export function createDefaultPrompts(columns: WorkflowColumn[]): TeamPrompt[] {
  return columns
    .filter((c) => Boolean(c.promptTemplate))
    .map((c) => ({
      id: promptIdForColumn(c.id),
      name: c.label || c.name,
      body: c.promptTemplate || "",
      studioPromptId: c.promptId,
      skillIds: c.id === FRY_COLUMN_ID ? ["doc-grill-me"] : [],
    }));
}

export function stampPromptRefs(columns: WorkflowColumn[]): WorkflowColumn[] {
  return columns.map((c) => ({
    ...c,
    promptRef: c.promptRef || (c.promptTemplate ? promptIdForColumn(c.id) : c.promptRef),
  }));
}

export function mergePrompts(saved?: TeamPrompt[], columns: WorkflowColumn[] = []): TeamPrompt[] {
  const seeded = createDefaultPrompts(columns);
  if (!saved?.length) return seeded;
  const byId = new Map(saved.map((p) => [p.id, p]));
  const merged = seeded.map((d) => {
    const hit = byId.get(d.id);
    if (!hit) return d;
    return {
      ...d,
      ...hit,
      id: d.id,
      skillIds: Array.isArray(hit.skillIds) ? hit.skillIds : d.skillIds,
    };
  });
  for (const p of saved) {
    if (!merged.some((m) => m.id === p.id)) merged.push({ ...p, skillIds: p.skillIds ?? [] });
  }
  return merged;
}

export function resolveStagePrompt(
  col: WorkflowColumn | undefined,
  prompts: TeamPrompt[] | undefined,
  docs: TeamDoc[] | undefined,
): { body: string; studioPromptId?: string; docs: TeamDoc[] } {
  const list = prompts ?? [];
  const library = docs ?? [];
  const p =
    (col?.promptRef ? list.find((x) => x.id === col.promptRef) : undefined) ??
    (col ? list.find((x) => x.id === promptIdForColumn(col.id)) : undefined);
  const body = p?.body ?? col?.promptTemplate ?? "";
  const skillIds = p?.skillIds ?? [];
  const attached = skillIds
    .map((id) => library.find((d) => d.id === id))
    .filter((d): d is TeamDoc => Boolean(d));
  const skillBlock = attached
    .map((d) => `\n\n<skill name="${d.title}">\n${d.body}\n</skill>`)
    .join("");
  return {
    body: `${body}${skillBlock}`.trim(),
    studioPromptId: p?.studioPromptId || col?.promptId,
    docs: attached.length ? attached : library,
  };
}
