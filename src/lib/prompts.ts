import type { TeamDoc, TeamPrompt, WorkflowColumn } from "./types";
import { NOTIFY_PROMPT_TEMPLATE, SEND_SLACK_COLUMN_ID } from "./columns.ts";
import { loadDiscoveryFlowSpec } from "./flow-spec.ts";

const FRY_COLUMN_ID = "fry";
const NOTIFY_PROMPT_ID = `prompt-${SEND_SLACK_COLUMN_ID}`;

export function canonicalizeNotifyPrompt(prompt: TeamPrompt): TeamPrompt {
  if (prompt.id !== NOTIFY_PROMPT_ID) return prompt;
  return { ...prompt, body: NOTIFY_PROMPT_TEMPLATE };
}

/** Combined system + user text shown in the prompt library for a JSON-backed stage. */
export function flowStagePromptBody(stageId: string): string | undefined {
  const stage = loadDiscoveryFlowSpec().stages.find((s) => s.id === stageId);
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
    const body = flowStagePromptBody(prompt.id.replace(/^prompt-/, ""));
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
  const byId = new Map(saved.map((p) => [p.id, p]));
  const merged = seeded.map((d) => {
    const hit = byId.get(d.id);
    if (!hit) return d;
    return {
      ...d,
      ...hit,
      id: d.id,
      skillIds: Array.isArray(hit.skillIds) ? hit.skillIds : d.skillIds,
      jiraKeys: Array.isArray(hit.jiraKeys) ? hit.jiraKeys : d.jiraKeys,
    };
  });
  for (const p of saved) {
    if (!merged.some((m) => m.id === p.id)) merged.push({ ...p, skillIds: p.skillIds ?? [], jiraKeys: p.jiraKeys ?? [] });
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
  const p =
    (col?.promptRef ? list.find((x) => x.id === col.promptRef) : undefined) ??
    (col ? list.find((x) => x.id === promptIdForColumn(col.id)) : undefined);
  const baseBody = p?.body ?? col?.promptTemplate ?? "";
  const body = baseBody;
  const skillIds = p?.skillIds ?? [];
  const attached = skillIds
    .map((id) => library.find((d) => d.id === id))
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
