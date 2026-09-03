import { mergePricing, usageFromText } from "./pricing.ts";
import type { ExecutionConfig, TokenUsage } from "./types.ts";
import {
  hasWebGpu,
  isDefaultWebllmModel,
  resolveWebllmModel,
  WEBLLM_PROFILES,
  type WebllmColumnRef,
} from "./webllm.ts";
import { clip, createLogger, persistRecentLogs, startCall } from "./logger.ts";
import { stripThinkBlocks } from "./cli-session.ts";
import {
  enqueueWebllmJob,
  finishWebllmJob,
  updateWebllmJob,
  type WebllmJobMeta,
} from "./webllm-runtime.ts";

const LOAD_TIMEOUT_MS = 10 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type CompletionChunk = {
  choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type MlcEngine = {
  unload?: () => Promise<void>;
  chat: {
    completions: {
      create: (opts: Record<string, unknown>) => Promise<CompletionChunk | AsyncIterable<CompletionChunk>>;
    };
  };
};

export type WebllmProgress = {
  phase: "check" | "load" | "generate" | "queued";
  text: string;
  pct?: number;
  modelId?: string;
};

export type WebllmCall = {
  text: string;
  ok: boolean;
  via: string;
  error?: string;
  usage?: TokenUsage;
  spend: number;
  modelId: string;
};

type LoadedEngine = { modelId: string; engine: MlcEngine };

let loaded: LoadedEngine | null = null;
let loadQueue: { modelId: string; promise: Promise<MlcEngine> } | null = null;

function logLine(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

export async function ensureWebllmEngine(
  modelId: string,
  onProgress?: (p: WebllmProgress) => void,
  job?: { id?: string } & WebllmJobMeta,
): Promise<MlcEngine> {
  const log = createLogger("exec.webllm");
  const note = (p: WebllmProgress) => {
    onProgress?.(p);
    if (job?.id) {
      updateWebllmJob(job.id, {
        phase: p.phase === "generate" ? "generate" : "load",
        pct: p.pct,
        text: p.text,
        modelId,
      });
    }
  };

  if (loaded?.modelId === modelId) return loaded.engine;
  if (loadQueue?.modelId === modelId) {
    log.info("load.queue", { modelId, reason: "same-model" });
    note({
      phase: "queued",
      modelId,
      text: `Queued — waiting for ${modelId} already downloading.`,
    });
    if (job?.id) updateWebllmJob(job.id, { phase: "queued", text: `Waiting for ${modelId}` });
    return loadQueue.promise;
  }
  if (loadQueue) {
    log.info("load.queue", { modelId, waitingOn: loadQueue.modelId });
    note({
      phase: "queued",
      modelId,
      text: `Queued behind ${loadQueue.modelId}.`,
    });
    if (job?.id) updateWebllmJob(job.id, { phase: "queued", text: `Queued behind ${loadQueue.modelId}` });
    try {
      await loadQueue.promise;
    } catch {
      /* previous load failed; try the requested model */
    }
    if (loaded?.modelId === modelId) return loaded.engine;
  }

  const promise = (async () => {
    if (!hasWebGpu()) {
      throw new Error("WebGPU is not available. Use Chrome or Edge on this Mac.");
    }
    const vramMb = WEBLLM_PROFILES.find((p) => p.modelId === modelId)?.vramMb;
    log.info("load.start", { modelId, vramMb });
    if (vramMb && vramMb >= 5000) {
      log.warn("load.vram", {
        modelId,
        vramMb,
        hint: "Quality 8B needs ~6GB GPU. Chrome can freeze with no new logs. Use Fast if this tab hangs.",
      });
    }
    note({
      phase: "load",
      modelId,
      pct: 0,
      text:
        vramMb && vramMb >= 5000
          ? `Downloading ${modelId} (~${Math.round(vramMb / 1024)} GB GPU). Chrome may freeze until this finishes.`
          : `Downloading ${modelId} — first run caches weights in this browser.`,
    });
    await persistRecentLogs();
    let mod: { CreateMLCEngine: (id: string, opts?: Record<string, unknown>) => Promise<MlcEngine> };
    try {
      mod = (await import("@mlc-ai/web-llm")) as unknown as typeof mod;
    } catch {
      throw new Error("WebLLM package is missing. Run npm install and restart npm run dev.");
    }
    if (loaded && loaded.modelId !== modelId) {
      try {
        await loaded.engine.unload?.();
      } catch {
        /* swap anyway */
      }
      loaded = null;
    }
    let lastPct = -1;
    let lastLogAt = 0;
    let engine: MlcEngine;
    try {
    engine = await withTimeout(
      mod.CreateMLCEngine(modelId, {
        initProgressCallback: (report: { text?: string; progress?: number }) => {
          const pct = typeof report.progress === "number" ? Math.round(report.progress * 100) : undefined;
          const detail = report.text?.trim() || `Downloading ${modelId}`;
          const text = pct != null ? `${detail} · ${pct}%` : detail;
          note({ phase: "load", modelId, pct, text });
          const now = Date.now();
          if (pct != null && (pct === 0 || pct === 100 || pct - lastPct >= 5 || now - lastLogAt > 2000)) {
            lastPct = pct ?? lastPct;
            lastLogAt = now;
            log.info("load.progress", { modelId, pct, detail });
            if (pct === 25 || pct === 50 || pct === 75 || pct === 100) void persistRecentLogs();
          }
        },
      }),
      LOAD_TIMEOUT_MS,
      `WebLLM load ${modelId}`,
    );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/memory|oom|out of memory|gpu/i.test(message)) {
        log.error("load.oom", {
          modelId,
          error: message,
          hint: "Chrome ran out of GPU memory. Switch Spec to Fast, then reload this tab.",
        });
        await persistRecentLogs();
      }
      throw err;
    }
    loaded = { modelId, engine };
    log.info("load.ok", { modelId });
    note({ phase: "load", modelId, pct: 100, text: `${modelId} ready in this browser.` });
    return engine;
  })();
  loadQueue = { modelId, promise };

  try {
    return await promise;
  } finally {
    if (loadQueue?.promise === promise) loadQueue = null;
  }
}

async function readCompletion(
  result: CompletionChunk | AsyncIterable<CompletionChunk>,
  onDelta?: (text: string) => void,
): Promise<{ text: string; usage?: TokenUsage }> {
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    let text = "";
    let usage: TokenUsage | undefined;
    for await (const chunk of result as AsyncIterable<CompletionChunk>) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        text += delta;
        onDelta?.(text);
      }
      const u = chunk.usage;
      if (u && (u.prompt_tokens != null || u.completion_tokens != null)) {
        usage = {
          inputTokens: u.prompt_tokens ?? 0,
          outputTokens: u.completion_tokens ?? 0,
          estimated: false,
        };
      }
    }
    return { text, usage };
  }
  const rec = result as CompletionChunk;
  const text = rec.choices?.[0]?.message?.content ?? rec.choices?.[0]?.delta?.content ?? "";
  const u = rec.usage;
  return {
    text: typeof text === "string" ? text : "",
    usage:
      u && (u.prompt_tokens != null || u.completion_tokens != null)
        ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, estimated: false }
        : undefined,
  };
}

export async function runWebllmCompletion(opts: {
  system: string;
  user: string;
  maxTokens: number;
  execution?: ExecutionConfig | null;
  column?: WebllmColumnRef | null;
  json?: boolean;
  onProgress?: (p: WebllmProgress) => void;
  job?: WebllmJobMeta;
}): Promise<WebllmCall> {
  const model = resolveWebllmModel(opts.column, opts.execution);
  const via = `WebLLM · ${model.label}`;
  const pricing = mergePricing(opts.execution?.pricing);
  const jobId = enqueueWebllmJob({
    modelId: model.modelId,
    text: `Starting ${via}…`,
    ticketKey: opts.job?.ticketKey,
    columnLabel: opts.job?.columnLabel ?? via,
    phase: "load",
  });
  const span = startCall("exec.webllm", {
    via,
    modelId: model.modelId,
    maxTokens: opts.maxTokens,
    json: Boolean(opts.json),
    ticket: opts.job?.ticketKey,
    column: opts.job?.columnLabel,
  });
  const attach = (call: Omit<WebllmCall, "spend" | "modelId">): WebllmCall => {
    const usage = call.usage ?? usageFromText([opts.system, opts.user].filter(Boolean).join("\n\n"), call.text, pricing.charsPerToken);
    return { ...call, usage, spend: 0, modelId: model.modelId };
  };

  try {
    if (typeof window === "undefined") {
      const error = "WebLLM runs in this browser tab, not on the server.";
      span.fail(error);
      return attach({ ok: false, text: "", via, error });
    }
    if (!hasWebGpu()) {
      const error = "WebGPU is not available. Use Chrome or Edge.";
      span.fail(error);
      return attach({ ok: false, text: "", via, error });
    }

    span.log.debug("prompt", {
      chars: opts.system.length + opts.user.length,
      prompt: clip(`${opts.system}\n\n${opts.user}`),
    });
    await persistRecentLogs();
    const engine = await ensureWebllmEngine(model.modelId, opts.onProgress, {
      id: jobId,
      ticketKey: opts.job?.ticketKey,
      columnLabel: opts.job?.columnLabel,
    });
    span.log.info("generate.start", { modelId: model.modelId, maxTokens: opts.maxTokens });
    updateWebllmJob(jobId, { phase: "generate", text: `Generating with ${model.modelId}…` });
    opts.onProgress?.({ phase: "generate", modelId: model.modelId, text: `Generating with ${model.modelId}…` });
    const genMs = Math.max(opts.execution?.stageTimeoutMs ?? opts.execution?.timeoutMs ?? 300000, 60_000);
    const result = await withTimeout(
      engine.chat.completions.create({
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ] satisfies ChatMessage[],
        max_tokens: opts.maxTokens,
        temperature: 0.3,
        stream: true,
        stream_options: { include_usage: true },
        enable_thinking: false,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      genMs,
      `WebLLM generate ${model.modelId}`,
    );
    const { text, usage } = await withTimeout(
      readCompletion(result, (partial) => {
        const visible = stripThinkBlocks(partial);
        opts.onProgress?.({
          phase: "generate",
          text: visible || (/<think/i.test(partial) ? "Thinking…" : partial),
        });
      }),
      genMs,
      `WebLLM stream ${model.modelId}`,
    );
    const body = stripThinkBlocks(text);
    if (!body) {
      span.fail(`${via} returned an empty body`);
      return attach({ ok: false, text: "", via, error: `${via} returned an empty body`, usage });
    }
    span.ok({ chars: body.length });
    return attach({ ok: true, text: body, via, usage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    span.fail(`${via}: ${message}`);
    updateWebllmJob(jobId, { phase: "error", text: message });
    return attach({ ok: false, text: "", via, error: `${via}: ${message}` });
  } finally {
    finishWebllmJob(jobId);
  }
}

export async function probeWebllm(opts: {
  execution: ExecutionConfig;
  prompt?: string;
  connectOnly?: boolean;
  column?: WebllmColumnRef | null;
  onLog?: (log: string) => void;
}): Promise<{
  ok: boolean;
  via: string;
  text: string;
  error?: string;
  checks: { ok: boolean; label: string; detail: string }[];
  log: string;
}> {
  const model = resolveWebllmModel(opts.column, opts.execution);
  const via = `WebLLM · ${model.label}`;
  const lines: string[] = [`[kindling] WebLLM ${model.modelId}`];
  const push = (line: string) => {
    lines.push(line);
    opts.onLog?.(logLine(lines));
  };
  const gpu = hasWebGpu();
  const checks = [
    { ok: gpu, label: "WebGPU", detail: gpu ? "navigator.gpu is present" : "Use Chrome or Edge with WebGPU." },
    { ok: true, label: "Profile", detail: `${model.label} · ${model.summary}` },
    { ok: Boolean(model.modelId), label: "Model", detail: model.modelId },
  ];
  if (!gpu) {
    return { ok: false, via, text: "", error: "WebGPU is not available", checks, log: logLine(lines) };
  }
  if (opts.connectOnly) {
    push("Connectivity-only: skipped weight download.");
    return { ok: true, via, text: "WebGPU ready", checks, log: logLine(lines) };
  }
  const call = await runWebllmCompletion({
    system: "Reply with exactly: pong",
    user: (opts.prompt || "ping").trim(),
    maxTokens: 32,
    execution: opts.execution,
    column: opts.column,
    onProgress: (p) => push(p.text.slice(0, 400)),
  });
  checks.push({
    ok: call.ok,
    label: "Generate",
    detail: call.ok ? call.text.slice(0, 200) : call.error || "empty",
  });
  if (call.text) push(call.text);
  if (call.error) push(call.error);
  return {
    ok: call.ok,
    via: call.via,
    text: call.ok ? call.text : "",
    error: call.error,
    checks,
    log: logLine(lines),
  };
}

export type WebllmCatalogEntry = {
  modelId: string;
  vramMb?: number;
  lowResource?: boolean;
  cached: boolean;
  isDefault: boolean;
  profileLabel?: string;
};

export type WebllmRuntimeStatus = {
  webgpu: boolean;
  webgpuDetail: string;
  packageVersion: string;
  modelVersion: string;
  loadedModelId: string | null;
  activeModelId: string;
  activeLabel: string;
  catalogCount: number;
  catalog: WebllmCatalogEntry[];
  error?: string;
};

type WebllmModule = {
  prebuiltAppConfig?: { model_list?: Array<Record<string, unknown>> };
  modelVersion?: string;
  hasModelInCache?: (modelId: string, appConfig?: unknown) => Promise<boolean>;
  CreateMLCEngine: (id: string, opts?: Record<string, unknown>) => Promise<MlcEngine>;
};

async function loadWebllmModule(): Promise<WebllmModule> {
  return (await import("@mlc-ai/web-llm")) as unknown as WebllmModule;
}

function asLlmCatalog(list: Array<Record<string, unknown>> | undefined): WebllmCatalogEntry[] {
  const defaults = new Map(WEBLLM_PROFILES.map((p) => [p.modelId, p.label]));
  const out: WebllmCatalogEntry[] = [];
  for (const row of list ?? []) {
    const modelId = typeof row.model_id === "string" ? row.model_id : "";
    if (!modelId) continue;
    const modelType = row.model_type;
    if (modelType === 1 || modelType === 2) continue;
    const vramMb = typeof row.vram_required_MB === "number" ? row.vram_required_MB : undefined;
    out.push({
      modelId,
      vramMb,
      lowResource: row.low_resource_required === true,
      cached: false,
      isDefault: defaults.has(modelId),
      profileLabel: defaults.get(modelId),
    });
  }
  out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (a.vramMb ?? 9e9) - (b.vramMb ?? 9e9);
  });
  return out;
}

export function loadedWebllmModelId(): string | null {
  return loaded?.modelId ?? null;
}

export async function unloadWebllmEngine(): Promise<void> {
  if (!loaded) return;
  try {
    await loaded.engine.unload?.();
  } catch {
    /* still drop the handle */
  }
  loaded = null;
}

export async function getWebllmStatus(exec?: ExecutionConfig | null): Promise<WebllmRuntimeStatus> {
  const gpu = hasWebGpu();
  const active = resolveWebllmModel(null, exec);
  const activeLabel = active.custom ? `Custom · ${active.modelId}` : `WebLLM · ${active.label}`;
  const base: WebllmRuntimeStatus = {
    webgpu: gpu,
    webgpuDetail: gpu ? "navigator.gpu is present" : "Use Chrome or Edge with WebGPU.",
    packageVersion: "@mlc-ai/web-llm",
    modelVersion: "",
    loadedModelId: loaded?.modelId ?? null,
    activeModelId: active.modelId,
    activeLabel,
    catalogCount: 0,
    catalog: [],
  };
  if (typeof window === "undefined") {
    return { ...base, error: "WebLLM status is only available in the browser." };
  }
  try {
    const mod = await loadWebllmModule();
    const catalog = asLlmCatalog(mod.prebuiltAppConfig?.model_list);
    if (typeof mod.hasModelInCache === "function") {
      await Promise.all(
        catalog.map(async (entry) => {
          try {
            entry.cached = await mod.hasModelInCache!(entry.modelId, mod.prebuiltAppConfig);
          } catch {
            entry.cached = false;
          }
        }),
      );
    }
    return {
      ...base,
      packageVersion: "@mlc-ai/web-llm",
      modelVersion: typeof mod.modelVersion === "string" ? mod.modelVersion : "",
      catalogCount: catalog.length,
      catalog,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : "Could not load the WebLLM catalog",
    };
  }
}

export async function pullWebllmModel(
  modelId: string,
  onProgress?: (p: WebllmProgress) => void,
): Promise<{ ok: boolean; modelId: string; error?: string }> {
  const id = modelId.trim();
  if (!id) return { ok: false, modelId: "", error: "Pick a model id." };
  if (typeof window === "undefined") {
    return { ok: false, modelId: id, error: "Pull runs in this browser tab." };
  }
  if (!hasWebGpu()) {
    return { ok: false, modelId: id, error: "WebGPU is not available. Use Chrome or Edge." };
  }
  const jobId = enqueueWebllmJob({
    modelId: id,
    text: `Pulling ${id}…`,
    columnLabel: "Settings",
    phase: "load",
  });
  try {
    await ensureWebllmEngine(id, onProgress, { id: jobId, columnLabel: "Settings" });
    return { ok: true, modelId: id };
  } catch (err) {
    return { ok: false, modelId: id, error: err instanceof Error ? err.message : "Pull failed" };
  } finally {
    finishWebllmJob(jobId);
  }
}


