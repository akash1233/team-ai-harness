import {
  APPROVE_COLUMN_ID,
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
} from "./columns.ts";
import { mergePricing } from "./pricing.ts";
import { createDefaultPrompts, stampPromptRefs } from "./prompts.ts";
import { createDefaultConnectors, mergeConnectors } from "./connectors.ts";
import { legacyDefaultAgent } from "./agents.ts";
import { DEFAULT_DOCS } from "./grill-skill.ts";
import { isWebllmProfile, normalizeWebllmModelIds } from "./webllm.ts";
import type { ExecutionConfig, Flow, TeamConfig, TeamDoc, TeamMember, WorkflowColumn } from "./types.ts";

export { executionLabel } from "./agents.ts";
export { DISCOVERY_FLOW_ID, QUICK_SPEC_FLOW_ID };

export const DEFAULT_MEMBERS: TeamMember[] = [
  { id: "m-maya", name: "Maya Chen", handle: "@maya", role: "Product" },
  { id: "m-jon", name: "Jon Hale", handle: "@jon", role: "Engineering" },
  { id: "m-priya", name: "Priya Shah", handle: "@priya", role: "Design" },
];

export function createDefaultColumns(): WorkflowColumn[] {
  return stampPromptRefs(cloneColumns());
}

export function createDiscoveryFlow(): Flow {
  return {
    id: DISCOVERY_FLOW_ID,
    name: "Discovery",
    description: "Brief → agenda (WebLLM) → notes → spec (WebLLM) → Grill Me → backlog (Cursor) → Jira.",
    columns: stampPromptRefs(cloneColumns()),
    autoAdvance: true,
    autoRun: false,
    continueInFlowId: QUICK_SPEC_FLOW_ID,
  };
}

export function createQuickSpecFlow(): Flow {
  return {
    id: QUICK_SPEC_FLOW_ID,
    name: "Quick spec",
    description: "Skip agenda and Slack. Brief → spec (WebLLM) → grill → backlog (Cursor) → Jira.",
    columns: stampPromptRefs(cloneColumns([
      IDEATION_COLUMN_ID,
      SYNTHESIZE_COLUMN_ID,
      FRY_COLUMN_ID,
      PREVIEW_FRY_COLUMN_ID,
      WRITE_PLAN_COLUMN_ID,
      APPROVE_COLUMN_ID,
      FILE_JIRA_COLUMN_ID,
      DONE_COLUMN_ID,
    ])),
    autoAdvance: true,
    autoRun: false,
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
    cursorCommand: "cursor-agent -p --output-format text",
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
    stageTimeoutMs: 300000,
    demoFallbacks: true,
    pricing: mergePricing(),
    claudeTestModel: "haiku",
    cursorTestModel: "auto",
    workspaceDir: "",
    cursorExtraArgs: "",
    claudeExtraArgs: "--permission-mode default",
    runInTerminal: true,
    fullAgentMode: false,
    webllmProfile: "balanced",
    webllmModelId: "",
    webllmExtraModelIds: [],
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
    prompts: createDefaultPrompts(active.columns),
    theme: "paper",
    density: "comfortable",
    pipelineLayout: "horizontal",
    showSpend: true,
    autoAdvance: active.autoAdvance,
    execution: createDefaultExecution(),
    connectors: createDefaultConnectors(),
  };
}

/** Boot always rebuilds Discovery from JSON. Session UI column edits are not merged back. */
export function mergeColumns(_saved?: WorkflowColumn[]): WorkflowColumn[] {
  return createDefaultColumns();
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
  merged.webllmProfile = isWebllmProfile(saved?.webllmProfile) ? saved.webllmProfile : d.webllmProfile;
  merged.webllmModelId = typeof saved?.webllmModelId === "string" ? saved.webllmModelId : d.webllmModelId;
  merged.webllmExtraModelIds = normalizeWebllmModelIds(saved?.webllmExtraModelIds ?? d.webllmExtraModelIds);
  return merged;
}

export function mergeFlows(_saved?: Flow[], _legacyColumns?: WorkflowColumn[]): Flow[] {
  return createDefaultFlows();
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

/** Keep in-memory Pipeline / Prompts / Flows edits for the current app process. */
export function restoreSessionPipeline(saved: Partial<TeamConfig>): TeamConfig {
  const boot = mergeTeamConfig({ ...saved, flows: undefined, columns: undefined, prompts: undefined });
  if (!saved.flows?.length && !saved.columns?.length && !saved.prompts?.length) return boot;

  const flows = saved.flows?.length
    ? saved.flows.map((f) => ({
        ...f,
        columns: f.columns?.length ? f.columns.map((c) => ({ ...c })) : boot.columns.map((c) => ({ ...c })),
      }))
    : boot.flows.map((f) =>
        f.id === (saved.activeFlowId ?? boot.activeFlowId) && saved.columns?.length
          ? { ...f, columns: saved.columns.map((c) => ({ ...c })) }
          : { ...f, columns: f.columns.map((c) => ({ ...c })) },
      );
  const activeFlowId =
    saved.activeFlowId && flows.some((f) => f.id === saved.activeFlowId) ? saved.activeFlowId : flows[0]!.id;
  const columns = (flows.find((f) => f.id === activeFlowId)?.columns ?? saved.columns ?? boot.columns).map((c) => ({
    ...c,
  }));
  const prompts = saved.prompts?.length ? saved.prompts.map((p) => ({ ...p })) : createDefaultPrompts(columns);
  return applyActiveFlow({ ...boot, flows, columns, prompts, activeFlowId }, activeFlowId);
}

export function mergeTeamConfig(saved?: Partial<TeamConfig>): TeamConfig {
  const d = createDefaultTeam();
  if (!saved) return d;
  const flows = createDefaultFlows();
  const activeFlowId =
    saved.activeFlowId && flows.some((f) => f.id === saved.activeFlowId) ? saved.activeFlowId : flows[0]!.id;
  const activeColumns = flows.find((f) => f.id === activeFlowId)?.columns ?? d.columns;
  return applyActiveFlow({
    ...d,
    ...saved,
    members: saved.members?.length ? saved.members : d.members,
    docs: mergeDocs(saved.docs),
    prompts: createDefaultPrompts(activeColumns),
    execution: mergeExecution(saved.execution),
    connectors: mergeConnectors(saved.connectors),
    flows,
    activeFlowId,
    columns: activeColumns,
    pipelineLayout: saved.pipelineLayout === "horizontal" || saved.pipelineLayout === "vertical" ? saved.pipelineLayout : d.pipelineLayout,
  });
}
