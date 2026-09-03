import discoveryFlowJson from "../../flows/discovery.flow.json" with { type: "json" };
import { isAgentKind } from "./agents.ts";
import { buildContext, interpolate, mentionedKeys } from "./flow-context.ts";
import type { StepAgent, TeamDoc, Ticket, WebllmProfile } from "./types.ts";
import { isWebllmProfile } from "./webllm.ts";

export type FlowStagePrompt = {
  system?: string;
  user?: string;
};

export type FlowStageSpec = {
  id: string;
  label: string;
  role: string;
  agent?: string;
  webllmProfile?: string;
  writes?: string[];
  maxTokens?: number;
  prompt?: FlowStagePrompt;
};

export type FlowSpec = {
  id: string;
  name: string;
  description?: string;
  variables: Record<string, string>;
  stages: FlowStageSpec[];
};

const DISCOVERY_FLOW_PATH = "flows/discovery.flow.json";

export function loadDiscoveryFlowSpec(): FlowSpec {
  return discoveryFlowJson as FlowSpec;
}

/** Reset cached spec (tests) — no-op with static JSON import. */
export function clearFlowSpecCache(): void {}

export function getFlowStage(stageId: string, flow: FlowSpec = loadDiscoveryFlowSpec()): FlowStageSpec | undefined {
  return flow.stages.find((s) => s.id === stageId);
}

/** JSON-backed stage agent (manual | cursor | claude | studio | cis | webllm). */
export function flowStageAgent(stageId: string, flow: FlowSpec = loadDiscoveryFlowSpec()): StepAgent | undefined {
  const agent = getFlowStage(stageId, flow)?.agent;
  if (agent === "manual" || isAgentKind(agent ?? "")) return agent as StepAgent;
  return undefined;
}

export function flowStageWebllmProfile(
  stageId: string,
  flow: FlowSpec = loadDiscoveryFlowSpec(),
): WebllmProfile | undefined {
  const profile = getFlowStage(stageId, flow)?.webllmProfile;
  return isWebllmProfile(profile) ? profile : undefined;
}

export function listFlowVariables(flow: FlowSpec = loadDiscoveryFlowSpec()): Record<string, string> {
  return { ...flow.variables };
}

export function flowStageMentionedKeys(stage: FlowStageSpec | undefined): string[] {
  if (!stage?.prompt) return [];
  const keys = [...mentionedKeys(stage.prompt.system), ...mentionedKeys(stage.prompt.user)];
  return [...new Set(keys)];
}

export function validateStagePrompt(stage: FlowStageSpec, flow: FlowSpec = loadDiscoveryFlowSpec()): string[] {
  const catalog = new Set(Object.keys(flow.variables));
  catalog.add("grillPhase");
  return flowStageMentionedKeys(stage).filter((key) => !catalog.has(key) && !key.startsWith("jira."));
}

function grillPhase(ticket: Ticket, grillSubmit?: boolean): string {
  return grillSubmit || ticket.grillRounds.some((r) => r.submitted)
    ? "The team answered the last round. Either ask the next frontier against the spec, or if the tree is settled, set frontierEmpty true and write conclusions planning must honor."
    : "Start round 1. Grill the Synthesize spec. Ask the whole frontier. One recommended answer per question.";
}

const DEFAULT_MAX_TOKENS = 4000;

function jsonPromptBody(stage: FlowStageSpec | undefined): string {
  if (!stage?.prompt) return "";
  return [stage.prompt.system, stage.prompt.user].filter((part) => part?.trim()).join("\n\n").trim();
}

/**
 * Resolves system + user for a run. Boot JSON is the default; a session
 * promptTemplate (Settings / Pipeline) wins for the rest of the session.
 */
export function resolveFlowStagePrompt(
  stageId: string,
  ticket: Ticket,
  docs?: TeamDoc[],
  opts?: { grillSubmit?: boolean; promptTemplate?: string },
): { system: string; user: string; max: number } | undefined {
  const stage = getFlowStage(stageId);
  const live = opts?.promptTemplate?.trim() || undefined;
  const jsonBody = jsonPromptBody(stage);
  const ctx = buildContext(ticket, docs);
  if (stageId === "fry") {
    ctx.grillPhase = grillPhase(ticket, opts?.grillSubmit);
  }
  const max = stage?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const defaultSystem = "Produce a concise operator-facing result.";
  const sessionEdited = Boolean(live && jsonBody && live !== jsonBody);
  const customOnly = Boolean(live && !stage?.prompt);

  if (sessionEdited || customOnly) {
    return {
      system: defaultSystem,
      user: interpolate(live!, ctx).trim(),
      max,
    };
  }

  if (!stage?.prompt) return undefined;

  const system = interpolate(stage.prompt.system ?? "", ctx).trim();
  const user = interpolate(stage.prompt.user ?? "", ctx).trim();
  return {
    system: system || defaultSystem,
    user,
    max,
  };
}

export function discoveryFlowPath(): string {
  return DISCOVERY_FLOW_PATH;
}

export function isDiscoveryFlow(flowId?: string): boolean {
  return !flowId || flowId === loadDiscoveryFlowSpec().id;
}
