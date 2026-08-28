import { createDefaultExecution } from "./team-config";
import { legacyDefaultAgent, resolveStep } from "./agents";
import type { AgentKind, ExecutionConfig, StepAgent } from "./types";

export type ModelCall = {
  text: string;
  ok: boolean;
  via: string;
  error?: string;
};

function envStr(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function resolveExecution(client?: ExecutionConfig): ExecutionConfig {
  const base = { ...createDefaultExecution(), ...client };
  const fromLegacy = legacyDefaultAgent(client);
  const envKind = envStr("PIT_PROVIDER") ?? envStr("PIT_DEFAULT_AGENT");
  const defaultAgent: AgentKind =
    envKind === "cursor" || envKind === "claude" || envKind === "studio" || envKind === "cis"
      ? envKind
      : (client?.defaultAgent ?? fromLegacy ?? base.defaultAgent);
  const cursorTarget = envStr("PIT_CURSOR_TARGET") === "remote" ? "remote" : envStr("PIT_CURSOR_TARGET") === "local" ? "local" : base.cursorTarget;
  const claudeTarget = envStr("PIT_CLAUDE_TARGET") === "remote" ? "remote" : envStr("PIT_CLAUDE_TARGET") === "local" ? "local" : base.claudeTarget;
  return {
    ...base,
    defaultAgent,
    cursorTarget,
    claudeTarget,
    cursorCommand: envStr("PIT_CURSOR_COMMAND") || base.cursorCommand,
    claudeCommand: envStr("PIT_CLAUDE_COMMAND") || base.claudeCommand,
    localHttpUrl: envStr("PIT_LOCAL_HTTP_URL") || base.localHttpUrl,
    cursorRemoteUrl: envStr("PIT_CURSOR_REMOTE_URL") || base.cursorRemoteUrl,
    claudeRemoteUrl: envStr("PIT_CLAUDE_REMOTE_URL") || base.claudeRemoteUrl,
    studioBaseUrl: (envStr("PIT_STUDIO_BASE_URL") || base.studioBaseUrl).replace(/\/$/, ""),
    featureKey: envStr("PIT_FEATURE_KEY") || base.featureKey,
    promptId: envStr("PIT_PROMPT_ID") || base.promptId,
    cisProvider: envStr("PIT_CIS_PROVIDER") || base.cisProvider,
    cisModel: envStr("PIT_CIS_MODEL") || base.cisModel,
    cisTaskType: envStr("PIT_CIS_TASK_TYPE") || base.cisTaskType,
    timeoutMs: Number(envStr("PIT_TIMEOUT_MS") || base.timeoutMs) || 120000,
    demoFallbacks: envStr("PIT_DEMO_FALLBACKS") === "0" ? false : envStr("PIT_DEMO_FALLBACKS") === "1" ? true : base.demoFallbacks,
    provider: defaultAgent === "studio" || defaultAgent === "cis" ? defaultAgent : "local",
    localAgent: defaultAgent === "claude" ? "claude" : "cursor",
  };
}

export function extractModelText(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body.trim();
  if (typeof body !== "object") return String(body);
  const rec = body as Record<string, unknown>;

  const paths: unknown[] = [
    rec.text,
    rec.content,
    rec.response,
    rec.output_text,
    rec.result,
    rec.prediction,
    rec.output,
    rec.choices,
    rec.generations,
  ];

  for (const p of paths) {
    const t = pickText(p);
    if (t) return t;
  }

  const nested = rec.data ?? rec.body ?? rec.payload;
  if (nested && nested !== body) {
    const t = extractModelText(nested);
    if (t) return t;
  }
  return "";
}

function pickText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const r = item as Record<string, unknown>;
          if (typeof r.text === "string") return r.text;
          if (typeof r.content === "string") return r.content;
          if (r.message) return pickText(r.message);
          if (Array.isArray(r.content)) return pickText(r.content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return joined;
  }
  if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    if (typeof r.text === "string" && r.text.trim()) return r.text.trim();
    if (typeof r.content === "string" && r.content.trim()) return r.content.trim();
    if (r.message) return pickText(r.message);
    if (r.output) return pickText(r.output);
    if (r.content) return pickText(r.content);
  }
  return "";
}

function parseCommand(line: string): { bin: string; args: string[] } {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  return { bin: parts[0] || "agent", args: parts.slice(1) };
}

async function runCli(bin: string, args: string[], timeoutMs: number): Promise<string> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(text ?? "");
    };
    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn(bin, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${bin} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      finish(e);
    });
    child.on("close", (code) => {
      const text = out.trim();
      if (code === 0 && text) {
        finish(null, text);
        return;
      }
      const detail = (err.trim() || text || `${bin} exited ${code}`).slice(0, 800);
      finish(new Error(detail));
    });
  });
}

async function callLocalCli(exec: ExecutionConfig, prompt: string, kind: "cursor" | "claude"): Promise<ModelCall> {
  const line = kind === "claude" ? exec.claudeCommand : exec.cursorCommand;
  const { bin, args } = parseCommand(line);
  const via = kind === "claude" ? "Claude" : "Cursor";
  const found = await lookupBin(bin);
  if (!found) {
    return {
      ok: false,
      text: "",
      via,
      error: `${via} CLI \`${bin}\` is not on PATH. Install it, or set a local HTTP URL.`,
    };
  }
  try {
    const text = await runCli(found, [...args, prompt], exec.timeoutMs);
    return { ok: true, text, via };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = /ENOENT|not found/i.test(message);
    return {
      ok: false,
      text: "",
      via,
      error: missing
        ? `${via} CLI \`${bin}\` is not on PATH. Install it, or set a local HTTP URL.`
        : `${via}: ${message}`,
    };
  }
}

function chatCompletionsUrl(base: string): string {
  const u = base.replace(/\/$/, "");
  if (u.endsWith("/chat/completions")) return u;
  if (u.endsWith("/v1")) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

async function callLocalHttp(
  urlBase: string,
  kind: "cursor" | "claude",
  exec: ExecutionConfig,
  system: string,
  user: string,
  maxTokens: number,
): Promise<ModelCall> {
  const url = chatCompletionsUrl(urlBase);
  const via = kind === "claude" ? "Claude HTTP" : "Cursor HTTP";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(exec.timeoutMs),
      body: JSON.stringify({
        model: kind,
        temperature: 0.4,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const raw = await res.text();
    let json: unknown = raw;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      /* text body */
    }
    if (!res.ok) {
      return { ok: false, text: "", via, error: `${via} ${res.status}: ${raw.slice(0, 400)}` };
    }
    const text = extractModelText(json) || (typeof json === "string" ? json : "");
    if (!text.trim()) return { ok: false, text: "", via, error: `${via} returned an empty body` };
    return { ok: true, text, via };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", via, error: `${via}: ${message}` };
  }
}

async function callStudio(
  exec: ExecutionConfig,
  prompt: string,
  promptId: string,
): Promise<ModelCall> {
  if (!exec.studioBaseUrl) {
    return { ok: false, text: "", via: "Studio", error: "Set Studio base URL in Team → Execution." };
  }
  if (!exec.featureKey) {
    return { ok: false, text: "", via: "Studio", error: "Set wd-pca-feature-key (your user ID) in Team → Execution." };
  }
  if (!promptId) {
    return { ok: false, text: "", via: "Studio", error: "Set a GenAI Studio prompt ID." };
  }
  const url = `${exec.studioBaseUrl}/v1alpha/prediction/cis/generate/${encodeURIComponent(promptId)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "wd-pca-feature-key": exec.featureKey,
      },
      signal: AbortSignal.timeout(exec.timeoutMs),
      body: JSON.stringify({
        inputArgs: { prompt },
      }),
    });
    const raw = await res.text();
    let json: unknown = raw;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      /* text */
    }
    if (!res.ok) {
      return { ok: false, text: "", via: "Studio", error: `Studio ${res.status}: ${raw.slice(0, 400)}` };
    }
    const text = extractModelText(json);
    if (!text) return { ok: false, text: "", via: "Studio", error: "Studio returned no model text." };
    return { ok: true, text, via: "Studio" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", via: "Studio", error: `Studio: ${message}` };
  }
}

async function callCis(
  exec: ExecutionConfig,
  prompt: string,
  maxTokens: number,
): Promise<ModelCall> {
  if (!exec.studioBaseUrl) {
    return { ok: false, text: "", via: "CIS", error: "Set Studio base URL in Team → Execution." };
  }
  if (!exec.featureKey) {
    return { ok: false, text: "", via: "CIS", error: "Set wd-pca-feature-key (your user ID) in Team → Execution." };
  }
  const url = `${exec.studioBaseUrl}/cis/v1alpha1/predictions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "wd-pca-feature-key": exec.featureKey,
      },
      signal: AbortSignal.timeout(exec.timeoutMs),
      body: JSON.stringify({
        target: {
          provider: exec.cisProvider || "aws",
          model: exec.cisModel,
        },
        task: {
          type: exec.cisTaskType || "aws-converse-v1",
          prediction_type: exec.cisTaskType || "aws-converse-v1",
          input: {
            temperature: 0.4,
            maxTokens,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: prompt }],
              },
            ],
            inferenceConfig: {
              temperature: 0.4,
              maxTokens,
            },
          },
        },
      }),
    });
    const raw = await res.text();
    let json: unknown = raw;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      /* text */
    }
    if (!res.ok) {
      return { ok: false, text: "", via: "CIS", error: `CIS ${res.status}: ${raw.slice(0, 400)}` };
    }
    const text = extractModelText(json);
    if (!text) return { ok: false, text: "", via: "CIS", error: "CIS returned no model text." };
    return { ok: true, text, via: "CIS" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", via: "CIS", error: `CIS: ${message}` };
  }
}

async function callRemoteAgent(
  url: string,
  kind: "cursor" | "claude",
  exec: ExecutionConfig,
  system: string,
  user: string,
  maxTokens: number,
): Promise<ModelCall> {
  const via = kind === "claude" ? "Claude remote" : "Cursor remote";
  const looksOpenAi = /\/v1(\/|$)/.test(url) || url.includes("chat/completions");
  if (looksOpenAi) return callLocalHttp(url, kind, exec, system, user, maxTokens);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(exec.featureKey ? { "wd-pca-feature-key": exec.featureKey } : {}),
      },
      signal: AbortSignal.timeout(exec.timeoutMs),
      body: JSON.stringify({
        agent: kind,
        system,
        user,
        prompt: [system, user].filter(Boolean).join("\n\n"),
        maxTokens,
      }),
    });
    const raw = await res.text();
    let json: unknown = raw;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      /* text */
    }
    if (!res.ok) return { ok: false, text: "", via, error: `${via} ${res.status}: ${raw.slice(0, 400)}` };
    const text = extractModelText(json) || (typeof json === "string" ? json : "");
    if (!text.trim()) return { ok: false, text: "", via, error: `${via} returned an empty body` };
    return { ok: true, text, via };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", via, error: `${via}: ${message}` };
  }
}

export async function runModel(opts: {
  system: string;
  user: string;
  maxTokens: number;
  execution?: ExecutionConfig;
  promptId?: string;
  stepAgent?: StepAgent;
}): Promise<ModelCall> {
  const exec = resolveExecution(opts.execution);
  const step = resolveStep({ agent: opts.stepAgent ?? "inherit" }, exec);
  const prompt = [opts.system, opts.user].filter(Boolean).join("\n\n");
  const promptId = opts.promptId || exec.promptId;

  if (step.kind === "studio") return callStudio(exec, prompt, promptId);
  if (step.kind === "cis") return callCis(exec, prompt, opts.maxTokens);

  const kind = step.kind;
  if (step.target === "remote") {
    const remoteUrl = kind === "claude" ? exec.claudeRemoteUrl : exec.cursorRemoteUrl;
    if (!remoteUrl.trim()) {
      return {
        ok: false,
        text: "",
        via: step.label,
        error: `Set the ${kind === "claude" ? "Claude" : "Cursor"} remote URL in Team → Execution.`,
      };
    }
    return callRemoteAgent(remoteUrl.trim(), kind, exec, opts.system, opts.user, opts.maxTokens);
  }

  if (exec.localHttpUrl.trim()) {
    return callLocalHttp(exec.localHttpUrl, kind, exec, opts.system, opts.user, opts.maxTokens);
  }
  return callLocalCli(exec, prompt, kind);
}

async function lookupBin(bin: string): Promise<string | null> {
  const { existsSync } = await import("node:fs");
  const { delimiter, join } = await import("node:path");
  if (!bin) return null;
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin) ? bin : null;
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function whichBin(bin: string): Promise<string | null> {
  return lookupBin(bin);
}

export async function probeModel(execution?: ExecutionConfig, stepAgent?: StepAgent): Promise<ModelCall> {
  const exec = { ...resolveExecution(execution), timeoutMs: 8000 };
  const step = resolveStep({ agent: stepAgent ?? "inherit" }, exec);
  if ((step.kind === "cursor" || step.kind === "claude") && step.target === "local" && !exec.localHttpUrl.trim()) {
    const line = step.kind === "claude" ? exec.claudeCommand : exec.cursorCommand;
    const { bin } = parseCommand(line);
    const via = step.label;
    const found = await whichBin(bin);
    if (found) return { ok: true, text: `Found ${bin} at ${found}`, via };
    return {
      ok: false,
      text: "",
      via,
      error: `${via}: \`${bin}\` is not on PATH. Install the CLI, set a local HTTP URL, or switch this stage to remote / Studio.`,
    };
  }
  return runModel({
    system: "You are a connectivity probe. Reply with exactly: pong",
    user: "ping",
    maxTokens: 16,
    execution: exec,
    stepAgent,
  });
}
