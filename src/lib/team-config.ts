import { COLUMNS } from "./columns";
import { legacyDefaultAgent } from "./agents";
import { DEFAULT_DOCS } from "./grill-skill";
import type { ExecutionConfig, TeamConfig, TeamDoc, TeamMember, WorkflowColumn } from "./types";

export { executionLabel } from "./agents";

export const DEFAULT_MEMBERS: TeamMember[] = [
  { id: "m-maya", name: "Maya Chen", handle: "@maya", role: "Product" },
  { id: "m-jon", name: "Jon Hale", handle: "@jon", role: "Engineering" },
  { id: "m-priya", name: "Priya Shah", handle: "@priya", role: "Design" },
];

export function createDefaultColumns(): WorkflowColumn[] {
  return COLUMNS.map((c) => ({ ...c }));
}

export function createDefaultExecution(): ExecutionConfig {
  return {
    defaultAgent: "cursor",
    cursorTarget: "local",
    claudeTarget: "local",
    cursorCommand: "agent -p --output-format text",
    claudeCommand: "claude -p --output-format text",
    localHttpUrl: "",
    cursorRemoteUrl: "",
    claudeRemoteUrl: "",
    studioBaseUrl: "",
    featureKey: "",
    promptId: "MGE0NzVjMTUtYmQwYi00MDQyLTk5NzgtMzliZWY2ZDFmZTRhOjpkaGFybWVuZHJhLnNpbmdo",
    cisProvider: "aws",
    cisModel: "anthropic.claude-haiku-4-5-20251001-v1:0",
    cisTaskType: "aws-converse-v1",
    timeoutMs: 120000,
    demoFallbacks: true,
    provider: "local",
    localAgent: "cursor",
  };
}

export function createDefaultTeam(): TeamConfig {
  return {
    name: "DX Insights",
    workflowName: "Discovery",
    jiraPrefix: "X2",
    defaultSlackChannel: "get-dx-insights-test",
    defaultSlackChannelId: "C0BQMKFR519",
    members: DEFAULT_MEMBERS.map((m) => ({ ...m })),
    labels: ["discovery", "pit-processed", "dx"],
    columns: createDefaultColumns(),
    docs: DEFAULT_DOCS.map((d) => ({ ...d })),
    theme: "paper",
    density: "comfortable",
    showSpend: true,
    autoAdvance: true,
    execution: createDefaultExecution(),
  };
}

export function mergeColumns(saved?: WorkflowColumn[]): WorkflowColumn[] {
  const defaults = createDefaultColumns();
  if (!saved?.length) return defaults;
  return saved.map((col) => {
    const base = defaults.find((d) => d.id === col.id);
    return {
      ...base,
      ...col,
      agent: col.agent ?? base?.agent ?? "inherit",
    };
  });
}

export function mergeDocs(saved?: TeamDoc[]): TeamDoc[] {
  const defaults = DEFAULT_DOCS.map((d) => ({ ...d }));
  if (!saved?.length) return defaults;
  const byId = new Map(saved.map((d) => [d.id, d]));
  const merged = defaults.map((d) => byId.get(d.id) ?? d);
  for (const d of saved) {
    if (!merged.some((m) => m.id === d.id)) merged.push(d);
  }
  return merged;
}

export function mergeExecution(saved?: Partial<ExecutionConfig>): ExecutionConfig {
  const d = createDefaultExecution();
  const merged = { ...d, ...saved };
  const fromLegacy = legacyDefaultAgent(saved);
  if (!saved?.defaultAgent && fromLegacy) merged.defaultAgent = fromLegacy;
  return merged;
}

export function mergeTeamConfig(saved?: Partial<TeamConfig>): TeamConfig {
  const d = createDefaultTeam();
  if (!saved) return d;
  return {
    ...d,
    ...saved,
    members: saved.members?.length ? saved.members : d.members,
    columns: mergeColumns(saved.columns),
    docs: mergeDocs(saved.docs),
    execution: mergeExecution(saved.execution),
  };
}
