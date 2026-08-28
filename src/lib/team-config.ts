import {
  APPROVE_COLUMN_ID,
  BLOCKED_COLUMN_ID,
  cloneColumns,
  DISCOVERY_FLOW_ID,
  DONE_COLUMN_ID,
  FILE_JIRA_COLUMN_ID,
  FRY_COLUMN_ID,
  IDEATION_COLUMN_ID,
  PREVIEW_FRY_COLUMN_ID,
  QUICK_SPEC_FLOW_ID,
  SYNTHESIZE_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
} from "./columns";
import { mergePricing } from "./pricing";
import { legacyDefaultAgent } from "./agents";
import { DEFAULT_DOCS } from "./grill-skill";
import type { ExecutionConfig, Flow, TeamConfig, TeamDoc, TeamMember, WorkflowColumn } from "./types";

export { executionLabel } from "./agents";
export { DISCOVERY_FLOW_ID, QUICK_SPEC_FLOW_ID };

export const DEFAULT_MEMBERS: TeamMember[] = [
  { id: "m-maya", name: "Maya Chen", handle: "@maya", role: "Product" },
  { id: "m-jon", name: "Jon Hale", handle: "@jon", role: "Engineering" },
  { id: "m-priya", name: "Priya Shah", handle: "@priya", role: "Design" },
];

export function createDefaultColumns(): WorkflowColumn[] {
  return cloneColumns();
}

export function createDiscoveryFlow(): Flow {
  return {
    id: DISCOVERY_FLOW_ID,
    name: "Discovery",
    description: "Brief → agenda (Cursor) → notes → spec (Studio) → Grill Me → backlog (Cursor) → Jira.",
    columns: cloneColumns(),
    autoAdvance: true,
    autoRun: true,
    continueInFlowId: QUICK_SPEC_FLOW_ID,
  };
}

export function createQuickSpecFlow(): Flow {
  return {
    id: QUICK_SPEC_FLOW_ID,
    name: "Quick spec",
    description: "Skip agenda and Slack. Brief → spec (Studio) → grill → backlog (Cursor) → Jira.",
    columns: cloneColumns([
      IDEATION_COLUMN_ID,
      SYNTHESIZE_COLUMN_ID,
      FRY_COLUMN_ID,
      PREVIEW_FRY_COLUMN_ID,
      WRITE_PLAN_COLUMN_ID,
      APPROVE_COLUMN_ID,
      FILE_JIRA_COLUMN_ID,
      DONE_COLUMN_ID,
      BLOCKED_COLUMN_ID,
    ]),
    autoAdvance: true,
    autoRun: true,
  };
}

export function createDefaultFlows(): Flow[] {
  return [createDiscoveryFlow(), createQuickSpecFlow()];
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
    pricing: mergePricing(),
    claudeTestModel: "haiku",
    cursorTestModel: "composer-1",
    provider: "local",
    localAgent: "cursor",
  };
}

export function createDefaultTeam(): TeamConfig {
  const flows = createDefaultFlows();
  const active = flows[0]!;
  return {
    name: "Kindling",
    workflowName: active.name,
    jiraPrefix: "X2",
    defaultSlackChannel: "get-dx-insights-test",
    defaultSlackChannelId: "C0BQMKFR519",
    members: DEFAULT_MEMBERS.map((m) => ({ ...m })),
    labels: ["discovery", "pit-processed", "dx"],
    columns: active.columns.map((c) => ({ ...c })),
    flows,
    activeFlowId: active.id,
    docs: DEFAULT_DOCS.map((d) => ({ ...d })),
    theme: "paper",
    density: "comfortable",
    pipelineLayout: "horizontal",
    showSpend: true,
    autoAdvance: active.autoAdvance,
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
      outputKey: col.outputKey ?? base?.outputKey,
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
  merged.pricing = mergePricing(saved?.pricing);
  return merged;
}

function mergeFlow(saved: Partial<Flow>, fallback: Flow): Flow {
  return {
    ...fallback,
    ...saved,
    id: saved.id || fallback.id,
    name: saved.name || fallback.name,
    description: saved.description ?? fallback.description,
    columns: saved.columns?.length ? mergeColumns(saved.columns) : fallback.columns.map((c) => ({ ...c })),
    autoAdvance: saved.autoAdvance ?? fallback.autoAdvance,
    autoRun: saved.autoRun ?? fallback.autoRun,
    continueInFlowId: saved.continueInFlowId ?? fallback.continueInFlowId,
  };
}

export function mergeFlows(saved?: Flow[], legacyColumns?: WorkflowColumn[]): Flow[] {
  const defaults = createDefaultFlows();
  if (!saved?.length) {
    if (legacyColumns?.length) {
      return [
        mergeFlow({ id: DISCOVERY_FLOW_ID, name: "Discovery", columns: legacyColumns }, defaults[0]!),
        defaults[1]!,
      ];
    }
    return defaults;
  }
  const byId = new Map(saved.map((f) => [f.id, f]));
  const merged = defaults.map((d) => {
    const hit = byId.get(d.id);
    return hit ? mergeFlow(hit, d) : d;
  });
  for (const f of saved) {
    if (!merged.some((m) => m.id === f.id)) {
      merged.push(mergeFlow(f, { ...defaults[0]!, id: f.id, name: f.name || "Untitled flow" }));
    }
  }
  return merged;
}

export function activeFlow(config: TeamConfig): Flow {
  return config.flows.find((f) => f.id === config.activeFlowId) ?? config.flows[0] ?? createDiscoveryFlow();
}

export function applyActiveFlow(config: TeamConfig, flowId?: string): TeamConfig {
  const flows = config.flows.length ? config.flows : createDefaultFlows();
  const flow = flows.find((f) => f.id === (flowId ?? config.activeFlowId)) ?? flows[0]!;
  return {
    ...config,
    flows,
    activeFlowId: flow.id,
    workflowName: flow.name,
    columns: flow.columns.map((c) => ({ ...c })),
    autoAdvance: flow.autoAdvance,
  };
}

export function writeFlowColumns(config: TeamConfig, columns: WorkflowColumn[]): TeamConfig {
  const flowId = config.activeFlowId;
  const flows = config.flows.map((f) => (f.id === flowId ? { ...f, columns } : f));
  return { ...config, flows, columns };
}

export function patchActiveFlow(config: TeamConfig, patch: Partial<Flow>): TeamConfig {
  const flows = config.flows.map((f) => (f.id === config.activeFlowId ? { ...f, ...patch, id: f.id } : f));
  const next = { ...config, flows };
  return applyActiveFlow(next, config.activeFlowId);
}

export function mergeTeamConfig(saved?: Partial<TeamConfig>): TeamConfig {
  const d = createDefaultTeam();
  if (!saved) return d;
  const flows = mergeFlows(saved.flows, saved.columns);
  const activeFlowId =
    saved.activeFlowId && flows.some((f) => f.id === saved.activeFlowId) ? saved.activeFlowId : flows[0]!.id;
  return applyActiveFlow({
    ...d,
    ...saved,
    members: saved.members?.length ? saved.members : d.members,
    docs: mergeDocs(saved.docs),
    execution: mergeExecution(saved.execution),
    flows,
    activeFlowId,
    columns: flows.find((f) => f.id === activeFlowId)?.columns ?? d.columns,
    pipelineLayout: saved.pipelineLayout === "horizontal" || saved.pipelineLayout === "vertical" ? saved.pipelineLayout : d.pipelineLayout,
  });
}
