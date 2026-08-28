import { createDefaultExecution } from "./team-config";
import { legacyDefaultAgent, resolveStep } from "./agents";
import { computeSpend, extractUsage, mergePricing, ratesFor, usageFromText } from "./pricing";
import {
  explainCliFailure,
  runAgentProcess,
  runProcess,
  withNonInteractiveFlags,
} from "./cli-session";
import type { AgentKind, ExecutionConfig, StepAgent, TokenUsage } from "./types";

export type ModelCall = {
  text: string;
  ok: boolean;
  via: string;
  error?: string;
  usage?: TokenUsage;
  spend?: number;
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
  const seeded = mergePricing(base.pricing);
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
    pricing: mergePricing({
      ...seeded,
      charsPerToken: Number(envStr("PIT_CHARS_PER_TOKEN") || seeded.charsPerToken) || seeded.charsPerToken,
      claude: {
        inputUsdPerMTok: Number(envStr("PIT_CLAUDE_IN_USD_PER_MTOK") || seeded.claude.inputUsdPerMTok),
        outputUsdPerMTok: Number(envStr("PIT_CLAUDE_OUT_USD_PER_MTOK") || seeded.claude.outputUsdPerMTok),
      },
      cursor: {
        inputUsdPerMTok: Number(envStr("PIT_CURSOR_IN_USD_PER_MTOK") || seeded.cursor.inputUsdPerMTok),
        outputUsdPerMTok: Number(envStr("PIT_CURSOR_OUT_USD_PER_MTOK") || seeded.cursor.outputUsdPerMTok),
      },
      studio: {
        inputUsdPerMTok: Number(envStr("PIT_STUDIO_IN_USD_PER_MTOK") || seeded.studio.inputUsdPerMTok),
        outputUsdPerMTok: Number(envStr("PIT_STUDIO_OUT_USD_PER_MTOK") || seeded.studio.outputUsdPerMTok),
      },
      cis: {
        inputUsdPerMTok: Number(envStr("PIT_CIS_IN_USD_PER_MTOK") || seeded.cis.inputUsdPerMTok),
        outputUsdPerMTok: Number(envStr("PIT_CIS_OUT_USD_PER_MTOK") || seeded.cis.outputUsdPerMTok),
      },
    }),
    provider: defaultAgent === "studio" || defaultAgent === "cis" ? defaultAgent : "local",
    localAgent: defaultAgent === "claude" ? "claude" : "cursor",
    workspaceDir: envStr("PIT_WORKSPACE") || base.workspaceDir || "",
    cursorExtraArgs: envStr("PIT_CURSOR_EXTRA_ARGS") || base.cursorExtraArgs || "--trust -f",
    claudeExtraArgs: envStr("PIT_CLAUDE_EXTRA_ARGS") || base.claudeExtraArgs || "--permission-mode dontAsk",
    runInTerminal: envStr("PIT_RUN_IN_TERMINAL") === "0" ? false : envStr("PIT_RUN_IN_TERMINAL") === "1" ? true : base.runInTerminal !== false,
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

function attachCost(
  call: ModelCall,
  exec: ExecutionConfig,
  kind: AgentKind,
  system: string,
  user: string,
): ModelCall {
  const pricing = mergePricing(exec.pricing);
  const usage =
    call.usage ?? usageFromText([system, user].filter(Boolean).join("\n\n"), call.text, pricing.charsPerToken);
  return {
    ...call,
    usage,
    spend: call.ok ? computeSpend(usage, ratesFor(kind, pricing)) : 0,
  };
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

export type SetupCheck = {
  ok: boolean;
  label: string;
  detail: string;
};

export type ProbeOptions = {
  stepAgent?: StepAgent;
  mode?: "connect" | "run";
  prompt?: string;
  mcp?: boolean;
  mcpServer?: string;
};

export function withModelFlag(args: string[], model: string): string[] {
  if (!model.trim()) return args;
  if (args.some((a) => a === "--model" || a === "-m" || a.startsWith("--model="))) return args;
  return ["--model", model.trim(), ...args];
}

export type SetupReport = {
  ok: boolean;
  via: string;
  text: string;
  error?: string;
  checks: SetupCheck[];
};

function extraBinDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const dirs = [
    home ? `${home}/.local/bin` : "",
    home ? `${home}/bin` : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  return dirs.filter(Boolean);
}

export function parseCommand(line: string): { bin: string; args: string[] } {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  return { bin: parts[0] || "agent", args: parts.slice(1) };
}

function workspaceOf(exec: ExecutionConfig): string {
  const dir = exec.workspaceDir?.trim();
  return dir || process.cwd();
}

async function invokeCli(
  exec: ExecutionConfig,
  kind: "cursor" | "claude",
  prompt: string,
  extraArgs: string[] = [],
  timeoutMs?: number,
): Promise<{ ok: boolean; text: string; error?: string; via: string }> {
  const line = kind === "claude" ? exec.claudeCommand : exec.cursorCommand;
  const { bin, args } = parseCommand(line);
  const via = kind === "claude" ? "Claude" : "Cursor";
  const found = await lookupBin(bin);
  if (!found) {
    return { ok: false, text: "", via, error: `${via} CLI \`${bin}\` is not on PATH. Install it, or set a local HTTP URL.` };
  }
  const flags = withNonInteractiveFlags(
    kind,
    [...args, ...extraArgs],
    kind === "claude" ? exec.claudeExtraArgs : exec.cursorExtraArgs,
  );
  const raw = await runAgentProcess({
    bin: found,
    args: [...flags, prompt],
    cwd: workspaceOf(exec),
    timeoutMs: timeoutMs ?? exec.timeoutMs,
    inTerminal: Boolean(exec.runInTerminal),
  });
  const body = (raw.out || raw.err).trim();
  const live = raw.via === "terminal" && body.length > 40;
  if ((raw.code === 0 && raw.out.trim()) || live) {
    return { ok: true, text: raw.out || body, via: raw.via === "terminal" ? `${via} Terminal` : via };
  }
  return {
    ok: false,
    text: body,
    via: raw.via === "terminal" ? `${via} Terminal` : via,
    error: explainCliFailure(body || `exit ${raw.code}`),
  };
}

async function callLocalCli(exec: ExecutionConfig, prompt: string, kind: "cursor" | "claude"): Promise<ModelCall> {
  const result = await invokeCli(exec, kind, prompt);
  if (result.ok) return { ok: true, text: result.text, via: result.via };
  const missing = /ENOENT|not found|not on PATH/i.test(result.error || "");
  return {
    ok: false,
    text: "",
    via: result.via,
    error: missing
      ? result.error
      : result.error || `${result.via}: empty response`,
  };
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
    return { ok: true, text, via, usage: extractUsage(json) ?? undefined };
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
    return { ok: true, text, via: "Studio", usage: extractUsage(json) ?? undefined };
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
    return { ok: true, text, via: "CIS", usage: extractUsage(json) ?? undefined };
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
    return { ok: true, text, via, usage: extractUsage(json) ?? undefined };
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
  const cost = (call: ModelCall) => attachCost(call, exec, step.kind, opts.system, opts.user);

  if (step.kind === "studio") return cost(await callStudio(exec, prompt, promptId));
  if (step.kind === "cis") return cost(await callCis(exec, prompt, opts.maxTokens));

  const kind = step.kind;
  if (step.target === "remote") {
    const remoteUrl = kind === "claude" ? exec.claudeRemoteUrl : exec.cursorRemoteUrl;
    if (!remoteUrl.trim()) {
      return cost({
        ok: false,
        text: "",
        via: step.label,
        error: `Set the ${kind === "claude" ? "Claude" : "Cursor"} remote URL in Team → Execution.`,
      });
    }
    return cost(await callRemoteAgent(remoteUrl.trim(), kind, exec, opts.system, opts.user, opts.maxTokens));
  }

  if (exec.localHttpUrl.trim()) {
    return cost(await callLocalHttp(exec.localHttpUrl, kind, exec, opts.system, opts.user, opts.maxTokens));
  }
  return cost(await callLocalCli(exec, prompt, kind));
}

async function runCliRaw(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; out: string; err: string }> {
  return runProcess(bin, args, timeoutMs, process.cwd());
}

type LocatedCli = {
  kind: "cursor" | "claude";
  bin: string;
  args: string[];
  found: { path: string; onPath: boolean; name: string } | null;
};

async function locateCli(kind: "cursor" | "claude", exec: ExecutionConfig): Promise<LocatedCli> {
  const line = kind === "claude" ? exec.claudeCommand : exec.cursorCommand;
  const { bin, args } = parseCommand(line);
  const aliases = kind === "claude" ? CLAUDE_ALIASES : CURSOR_ALIASES;
  const names = [bin, ...aliases.filter((a) => a !== bin)];
  let found: LocatedCli["found"] = null;
  for (const name of names) {
    const hit = await locateBin(name);
    if (hit) {
      found = { ...hit, name };
      break;
    }
  }
  return { kind, bin, args, found };
}

function pushCliChecks(checks: SetupCheck[], located: LocatedCli): boolean {
  const via = located.kind === "claude" ? "Claude" : "Cursor";
  if (!located.found) {
    checks.push({
      ok: false,
      label: `${via} CLI`,
      detail: `\`${located.bin}\` was not on PATH or in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin. Install it, then restart npm run dev from Terminal.`,
    });
    return false;
  }
  if (located.found.name !== located.bin) {
    checks.push({
      ok: false,
      label: `${via} command`,
      detail: `Configured \`${located.bin}\` is missing. Found \`${located.found.name}\` at ${located.found.path}. Set the local command to: ${located.found.name} -p --output-format text`,
    });
  } else if (!located.found.onPath) {
    checks.push({
      ok: true,
      label: `${via} CLI`,
      detail: `Found at ${located.found.path} (not on Node PATH). Runs will use this path.`,
    });
  } else {
    checks.push({
      ok: true,
      label: `${via} CLI`,
      detail: `Found ${located.found.name} at ${located.found.path}`,
    });
  }
  return true;
}

async function pingAgent(
  located: LocatedCli,
  exec: ExecutionConfig,
  prompt: string,
): Promise<SetupCheck> {
  const via = located.kind === "claude" ? "Claude" : "Cursor";
  const model =
    located.kind === "claude"
      ? exec.claudeTestModel?.trim() || "haiku"
      : exec.cursorTestModel?.trim() || "composer-1";
  const extra = model ? ["--model", model] : [];
  const result = await invokeCli(
    exec,
    located.kind,
    prompt,
    extra,
    Math.min(Math.max(exec.timeoutMs, 20000), 120000),
  );
  const body = (result.text || result.error || "").slice(0, 800);
  return {
    ok: result.ok,
    label: `${via} test run (${model}${exec.runInTerminal ? " · Terminal" : ""})`,
    detail: result.ok
      ? `request: ${prompt}\nresponse: ${body}`
      : `request: ${prompt}\n${body}`,
  };
}

async function probeMcp(kind: "cursor" | "claude", located: LocatedCli, server?: string): Promise<SetupCheck[]> {
  const via = kind === "claude" ? "Claude" : "Cursor";
  if (!located.found) {
    return [{ ok: false, label: `${via} MCP`, detail: `${via} CLI is not installed — cannot list MCP servers.` }];
  }
  const list = await runCliRaw(located.found.path, ["mcp", "list"], 20000);
  const text = (list.out || list.err).slice(0, 1200);
  const checks: SetupCheck[] = [];
  if (list.code !== 0 && !text) {
    checks.push({
      ok: false,
      label: `${via} MCP list`,
      detail: `${via} does not expose \`mcp list\` or it failed.`,
    });
    return checks;
  }
  const failed = /✘|Failed to connect/i.test(text);
  const none = !text.trim() || /no mcp servers|none configured|0 servers/i.test(text);
  checks.push({
    ok: list.code === 0 && !failed,
    label: `${via} MCP list`,
    detail: none ? "No MCP servers configured." : text || `exit ${list.code}`,
  });
  const name = server?.trim();
  if (name) {
    const get = await runCliRaw(located.found.path, ["mcp", "get", name], 20000);
    const body = (get.out || get.err).slice(0, 800);
    const issue = /Issue:|Failed to connect|✘/i.test(body);
    checks.push({
      ok: get.code === 0 && !issue,
      label: `${via} MCP get ${name}`,
      detail: body || `exit ${get.code}`,
    });
  }
  return checks;
}

async function lookupBin(bin: string): Promise<string | null> {
  const hit = await locateBin(bin);
  return hit?.path ?? null;
}

async function locateBin(bin: string): Promise<{ path: string; onPath: boolean } | null> {
  const { existsSync } = await import("node:fs");
  const { delimiter, join } = await import("node:path");
  if (!bin) return null;
  if (bin.includes("/") || bin.includes("\\")) {
    return existsSync(bin) ? { path: bin, onPath: true } : null;
  }
  const pathDirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return { path: candidate, onPath: true };
  }
  for (const dir of extraBinDirs()) {
    if (pathDirs.includes(dir)) continue;
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return { path: candidate, onPath: false };
  }
  return null;
}

async function runVersion(binPath: string): Promise<{ ok: boolean; text: string }> {
  const raw = await runProcess(binPath, ["--version"], 20000);
  const text = (raw.out || raw.err).trim();
  if (text) return { ok: true, text: text.split("\n")[0] || text };
  if (raw.code === 0) return { ok: true, text: "ok" };
  return { ok: false, text: text || `${binPath} --version timed out` };
}

const CURSOR_ALIASES = ["agent", "cursor-agent", "cursor"];
const CLAUDE_ALIASES = ["claude"];

export async function probeSetup(
  execution?: ExecutionConfig,
  stepAgent?: StepAgent,
  options?: ProbeOptions,
): Promise<SetupReport> {
  const exec = resolveExecution(execution);
  const step = resolveStep({ agent: options?.stepAgent ?? stepAgent ?? "inherit" }, exec);
  const checks: SetupCheck[] = [];
  const via = step.label;
  const mode = options?.mode ?? "connect";
  const prompt = (options?.prompt || "Reply with exactly: pong").trim();

  checks.push({
    ok: true,
    label: "Agent",
    detail: `${via}${exec.demoFallbacks ? " · demo fallbacks are still on" : ""}`,
  });

  if (step.kind === "studio" || step.kind === "cis") {
    const base = exec.studioBaseUrl.trim();
    checks.push({
      ok: Boolean(base),
      label: "Studio base URL",
      detail: base || "Set the GenAI Studio host (no trailing slash).",
    });
    checks.push({
      ok: Boolean(exec.featureKey.trim()),
      label: "Feature key",
      detail: exec.featureKey.trim()
        ? "wd-pca-feature-key is set (your user id, not an API token)."
        : "Set wd-pca-feature-key to your user id.",
    });
    if (step.kind === "studio") {
      checks.push({
        ok: Boolean(exec.promptId.trim()),
        label: "Prompt ID",
        detail: exec.promptId.trim() || "Copy Prompt ID from GenAI Studio (File → Copy Prompt ID).",
      });
    } else {
      checks.push({
        ok: Boolean(exec.cisModel.trim()),
        label: "CIS model",
        detail: exec.cisModel.trim() || "Set the CIS / Bedrock model id.",
      });
    }
    if (base) {
      try {
        const url = new URL(base);
        checks.push({
          ok: url.protocol === "http:" || url.protocol === "https:",
          label: "URL shape",
          detail: `${url.protocol}//${url.host}`,
        });
      } catch {
        checks.push({ ok: false, label: "URL shape", detail: "Base URL is not a valid http(s) URL." });
      }
    }
    if (mode === "run" && checks.every((c) => c.ok)) {
      const ping = await runModel({
        system: "You are a connectivity probe. Reply with exactly: pong",
        user: prompt,
        maxTokens: 16,
        execution: { ...exec, timeoutMs: 20000 },
        stepAgent: step.kind,
      });
      checks.push({
        ok: ping.ok,
        label: `${via} test run`,
        detail: ping.ok
          ? `request: ${prompt}\nresponse: ${ping.text.slice(0, 400)}`
          : ping.error || "empty response",
      });
    }
  } else if (options?.mcp && (step.kind === "cursor" || step.kind === "claude")) {
    const located = await locateCli(step.kind, exec);
    pushCliChecks(checks, located);
    checks.push(...(await probeMcp(step.kind, located, options.mcpServer)));
  } else if (step.target === "remote") {
    const remoteUrl = (step.kind === "claude" ? exec.claudeRemoteUrl : exec.cursorRemoteUrl).trim();
    checks.push({
      ok: Boolean(remoteUrl),
      label: "Remote URL",
      detail: remoteUrl || `Set the ${step.kind === "claude" ? "Claude" : "Cursor"} remote URL.`,
    });
    if (remoteUrl) {
      try {
        const url = new URL(remoteUrl);
        checks.push({
          ok: url.protocol === "http:" || url.protocol === "https:",
          label: "URL shape",
          detail: `${url.protocol}//${url.host}${url.pathname}`,
        });
      } catch {
        checks.push({ ok: false, label: "URL shape", detail: "Remote URL is not a valid http(s) URL." });
      }
    }
    if (mode === "run" && remoteUrl) {
      const ping = await runModel({
        system: "You are a connectivity probe. Reply with exactly: pong",
        user: prompt,
        maxTokens: 16,
        execution: { ...exec, timeoutMs: 20000 },
        stepAgent: step.kind,
      });
      checks.push({
        ok: ping.ok,
        label: `${via} test run`,
        detail: ping.ok
          ? `request: ${prompt}\nresponse: ${ping.text.slice(0, 400)}`
          : ping.error || "empty response",
      });
    }
  } else if (exec.localHttpUrl.trim() && !options?.mcp) {
    const sidecar = exec.localHttpUrl.trim();
    try {
      const url = new URL(chatCompletionsUrl(sidecar));
      checks.push({
        ok: true,
        label: "Local HTTP sidecar",
        detail: url.toString(),
      });
    } catch {
      checks.push({ ok: false, label: "Local HTTP sidecar", detail: "Sidecar URL is not valid." });
    }
    if (mode === "run") {
      const ping = await runModel({
        system: "You are a connectivity probe. Reply with exactly: pong",
        user: prompt,
        maxTokens: 16,
        execution: { ...exec, timeoutMs: 20000 },
        stepAgent: step.kind,
      });
      checks.push({
        ok: ping.ok,
        label: `${via} test run`,
        detail: ping.ok
          ? `request: ${prompt}\nresponse: ${ping.text.slice(0, 400)}`
          : ping.error || "empty response",
      });
    }
  } else if (step.kind === "cursor" || step.kind === "claude") {
    const located = await locateCli(step.kind, exec);
    const present = pushCliChecks(checks, located);
    if (located.found) {
      const ver = await runVersion(located.found.path);
      checks.push({
        ok: true,
        label: `${located.found.name} --version`,
        detail: ver.ok
          ? ver.text
          : `${ver.text} — binary is installed; version is slow. Not a blocker.`,
      });
    }
    if (present && located.found && mode === "run") {
      checks.push(await pingAgent(located, exec, prompt));
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;
  const text = ok
    ? checks
        .filter((c) => c.ok)
        .map((c) => c.detail.split("\n")[0])
        .slice(0, 2)
        .join(" · ")
    : failed[0]?.detail || "Setup incomplete";
  return {
    ok,
    via,
    text,
    error: ok ? undefined : text,
    checks,
  };
}

export async function probeModel(execution?: ExecutionConfig, stepAgent?: StepAgent): Promise<ModelCall> {
  const report = await probeSetup(execution, stepAgent);
  return {
    ok: report.ok,
    via: report.via,
    text: report.text,
    error: report.error,
  };
}
