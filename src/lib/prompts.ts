import type { TeamDoc, TeamPrompt, WorkflowColumn } from "./types";
import { FRY_DOC_ID, isFryStage, migrateColumnId, NOTIFY_PROMPT_TEMPLATE, SEND_SLACK_COLUMN_ID } from "./columns.ts";
import { migrateDocId, migratePromptId } from "./fry-migrate.ts";
import { getFlowStage } from "./flow-spec.ts";

const NOTIFY_PROMPT_ID = `prompt-${SEND_SLACK_COLUMN_ID}`;

export function canonicalizeNotifyPrompt(prompt: TeamPrompt): TeamPrompt {
  if (prompt.id !== NOTIFY_PROMPT_ID) return prompt;
  return { ...prompt, body: NOTIFY_PROMPT_TEMPLATE };
}

/** Combined system + user text shown in the prompt library for a JSON-backed stage. */
export function flowStagePromptBody(stageId: string): string | undefined {
  const stage = getFlowStage(stageId);
  if (!stage?.prompt) return undefined;
  return [stage.prompt.system, stage.prompt.user].filter((part) => part?.trim()).join("\n\n");
}

/**
 * flows/discovery.flow.json is the source of truth for the Discovery pipeline.
 * Saved library bodies for JSON-backed stages are stale — overwrite them on
 * boot so Settings matches what actually runs. In-app edits are session-only.
 */
export function canonicalizeFlowPrompts(prompts: TeamPrompt[]): TeamPrompt[] {
  return prompts.map((prompt) => {
    const body = flowStagePromptBody(migratePromptId(prompt.id).replace(/^prompt-/, ""));
    return body !== undefined ? { ...prompt, body } : prompt;
  });
}

export function bindJiraKey(keys: string[] | undefined, key: string): string[] {
  const normalized = key.trim().toUpperCase();
  if (!normalized) return keys ?? [];
  return [...(keys ?? []).filter((value) => value.toUpperCase() !== normalized), normalized];
}

export function unbindJiraKey(keys: string[] | undefined, key: string): string[] {
  const normalized = key.trim().toUpperCase();
  return (keys ?? []).filter((value) => value.toUpperCase() !== normalized);
}

export function promptIdForColumn(columnId: string): string {
  return `prompt-${migrateColumnId(columnId)}`;
}

export function createDefaultPrompts(columns: WorkflowColumn[]): TeamPrompt[] {
  return columns
    .filter((c) => Boolean(c.promptTemplate))
    .map((c) => ({
      id: promptIdForColumn(c.id),
      name: c.label || c.name,
      body: c.promptTemplate || "",
      studioPromptId: c.promptId,
      skillIds: isFryStage(c.id) ? [FRY_DOC_ID] : [],
      jiraKeys: [],
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
  if (!saved?.length) return canonicalizeFlowPrompts(seeded);
  const byId = new Map(
    saved.map((p) => {
      const id = migratePromptId(p.id);
      const skillIds = (p.skillIds ?? []).map(migrateDocId);
      return [id, { ...p, id, skillIds }] as const;
    }),
  );
  const merged = seeded.map((d) => {
    const hit = byId.get(d.id);
    if (!hit) return d;
    return {
      ...d,
      ...hit,
      id: d.id,
      skillIds: Array.isArray(hit.skillIds) ? hit.skillIds.map(migrateDocId) : d.skillIds,
      jiraKeys: Array.isArray(hit.jiraKeys) ? hit.jiraKeys : d.jiraKeys,
    };
  });
  for (const p of saved) {
    const id = migratePromptId(p.id);
    const skillIds = (p.skillIds ?? []).map(migrateDocId);
    if (!merged.some((m) => m.id === id)) merged.push({ ...p, id, skillIds, jiraKeys: p.jiraKeys ?? [] });
  }
  return canonicalizeFlowPrompts(merged.map(canonicalizeNotifyPrompt));
}

export function resolveStagePrompt(
  col: WorkflowColumn | undefined,
  prompts: TeamPrompt[] | undefined,
  docs: TeamDoc[] | undefined,
): { body: string; baseBody: string; studioPromptId?: string; docs: TeamDoc[]; jiraKeys: string[] } {
  const list = prompts ?? [];
  const library = docs ?? [];
  const wantedPrompt = col?.promptRef
    ? migratePromptId(col.promptRef)
    : col
      ? promptIdForColumn(col.id)
      : undefined;
  const p = wantedPrompt ? list.find((x) => migratePromptId(x.id) === wantedPrompt) : undefined;
  const baseBody = p?.body ?? col?.promptTemplate ?? "";
  const body = baseBody;
  const skillIds = p?.skillIds ?? [];
  const attached = skillIds
    .map((id) => library.find((d) => migrateDocId(d.id) === migrateDocId(id)))
    .filter((d): d is TeamDoc => Boolean(d));
  const skillBlock = attached
    .map((d) => `\n\n<skill name="${d.title}">\n${d.body}\n</skill>`)
    .join("");
  return {
    body: `${body}${skillBlock}`.trim(),
    baseBody,
    studioPromptId: p?.studioPromptId || col?.promptId,
    docs: attached.length ? attached : library,
    jiraKeys: p?.jiraKeys ?? [],
  };
}
