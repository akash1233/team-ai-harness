import type { AgentKind, AgentTarget, ExecutionConfig, StepAgent, WorkflowColumn } from "./types.ts";

export const AGENT_KINDS: AgentKind[] = ["cursor", "claude", "studio", "cis"];

export type StepColumnRef = { agent?: StepAgent; role?: WorkflowColumn["role"] };

export type ResolvedStep = {
  kind: AgentKind;
  target: AgentTarget;
  label: string;
  manual: boolean;
};

/** Human-only stage — no agent call. Explicit manual agent or collect-input role. */
export function isManualStep(column?: StepColumnRef | null): boolean {
  if (!column) return false;
  if (column.agent === "manual") return true;
  return column.role === "collect-input";
}

export function legacyDefaultAgent(exec?: Partial<ExecutionConfig> | null): AgentKind | undefined {
  if (!exec) return undefined;
  if (exec.defaultAgent) return exec.defaultAgent;
  if (exec.provider === "studio") return "studio";
  if (exec.provider === "cis") return "cis";
  if (exec.localAgent === "claude") return "claude";
  if (exec.provider === "local" || exec.localAgent === "cursor") return "cursor";
  return undefined;
}

export function resolveStep(column: StepColumnRef | null | undefined, exec?: ExecutionConfig | null): ResolvedStep {
  const fallback: AgentKind = legacyDefaultAgent(exec) ?? exec?.defaultAgent ?? "cursor";
  if (isManualStep(column)) {
    return { kind: fallback, target: "local", label: "Manual", manual: true };
  }
  const agent = column?.agent;
  const kind: AgentKind = agent && agent !== "inherit" && agent !== "manual" ? agent : fallback;
  const target: AgentTarget =
    kind === "cursor" ? (exec?.cursorTarget ?? "local") : kind === "claude" ? (exec?.claudeTarget ?? "local") : "remote";
  return { kind, target, label: stepLabel(kind, target), manual: false };
}

/** Short badge for pipeline chrome — Manual, Cursor, Claude, etc. */
export function stepBadge(column: StepColumnRef | null | undefined, exec?: ExecutionConfig | null): string | null {
  if (!column) return null;
  if (isManualStep(column)) return "Manual";
  if (column.agent && column.agent !== "inherit") return shortAgent(resolveStep(column, exec).kind);
  return null;
}

export function stepLabel(kind: AgentKind, target: AgentTarget): string {
  if (kind === "studio") return "GenAI Studio";
  if (kind === "cis") return "CIS";
  const where = target === "remote" ? "remote" : "local";
  return kind === "claude" ? `Claude ${where}` : `Cursor ${where}`;
}

export function shortAgent(kind: AgentKind): string {
  if (kind === "studio") return "Studio";
  if (kind === "cis") return "CIS";
  if (kind === "claude") return "Claude";
  return "Cursor";
}

export function executionLabel(exec?: ExecutionConfig | null): string {
  const step = resolveStep({ agent: "inherit" }, exec ?? undefined);
  return step.label;
}
