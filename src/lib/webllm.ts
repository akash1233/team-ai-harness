import { SEND_SLACK_COLUMN_ID } from "./columns.ts";
import type { ExecutionConfig, WebllmProfile, WorkflowColumn } from "./types.ts";

export type WebllmProfileSpec = {
  id: WebllmProfile;
  label: string;
  modelId: string;
  vramMb: number;
  contextTokens: number;
  summary: string;
};

/** Confirmed MLC model ids from @mlc-ai/web-llm prebuiltAppConfig (Qwen3 family). */
export const WEBLLM_PROFILES: readonly WebllmProfileSpec[] = [
  {
    id: "fast",
    label: "Fast",
    modelId: "Qwen3-1.7B-q4f32_1-MLC",
    vramMb: 2635,
    contextTokens: 4096,
    summary: "1.7B · lowest VRAM · agenda and short drafts",
  },
  {
    id: "balanced",
    label: "Balanced",
    modelId: "Qwen3-4B-q4f16_1-MLC",
    vramMb: 3432,
    contextTokens: 4096,
    summary: "4B · default · grill JSON and backlog",
  },
  {
    id: "quality",
    label: "Quality",
    modelId: "Qwen3-8B-q4f16_1-MLC",
    vramMb: 5696,
    contextTokens: 4096,
    summary: "8B · spec-quality · needs ~6 GB GPU memory",
  },
];

export const WEBLLM_PROFILE_IDS: readonly WebllmProfile[] = WEBLLM_PROFILES.map((p) => p.id);

export const WEBLLM_DEFAULT_MODEL_IDS: readonly string[] = WEBLLM_PROFILES.map((p) => p.modelId);

export function isDefaultWebllmModel(modelId: string): boolean {
  return WEBLLM_DEFAULT_MODEL_IDS.includes(modelId.trim());
}

export function normalizeWebllmModelIds(ids?: string[] | null): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id) || isDefaultWebllmModel(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type WebllmResolved = WebllmProfileSpec & {
  custom: boolean;
};

export function isWebllmProfile(value: unknown): value is WebllmProfile {
  return value === "fast" || value === "balanced" || value === "quality";
}

export function profileSpec(id?: string | null): WebllmProfileSpec {
  return WEBLLM_PROFILES.find((p) => p.id === id) ?? WEBLLM_PROFILES[1]!;
}

export type WebllmColumnRef = {
  id?: string;
  webllmProfile?: WebllmProfile;
};

export function resolveWebllmProfile(
  column?: WebllmColumnRef | null,
  exec?: ExecutionConfig | null,
): WebllmProfileSpec {
  return profileSpec(column?.webllmProfile || exec?.webllmProfile || "balanced");
}

export function resolveWebllmModel(
  column?: WebllmColumnRef | null,
  exec?: ExecutionConfig | null,
): WebllmResolved {
  const profile = resolveWebllmProfile(column, exec);
  const custom = exec?.webllmModelId?.trim() && !column?.webllmProfile ? exec.webllmModelId.trim() : "";
  const modelId = custom || profile.modelId;
  return { ...profile, modelId, custom: Boolean(custom) };
}

export function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Notify needs slack-mcp; WebLLM cannot call tools. */
export function webllmBlockedReason(columnId?: string): string | undefined {
  if (columnId === SEND_SLACK_COLUMN_ID) {
    return "Notify posts via slack-mcp. Pin this stage to Cursor.";
  }
  return undefined;
}

export function stageUsesWebllm(
  column: Pick<WorkflowColumn, "agent" | "role"> | null | undefined,
  exec?: ExecutionConfig | null,
): boolean {
  if (!column) return false;
  if (column.agent === "manual" || column.role === "collect-input") return false;
  if (column.agent === "webllm") return true;
  if (column.agent && column.agent !== "inherit") return false;
  return exec?.defaultAgent === "webllm";
}

/**
 * TanStack Start serializes server-fn payloads with Seroval. Callbacks
 * (onProgress, onLog) must never go on the wire.
 */
export function withoutRuntimeCallbacks<T extends object>(data: T): Omit<T, "onProgress" | "onLog"> {
  const { onProgress: _p, onLog: _l, ...rest } = data as T & {
    onProgress?: unknown;
    onLog?: unknown;
  };
  return rest;
}
