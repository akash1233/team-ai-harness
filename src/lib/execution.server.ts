import { createDefaultExecution } from "./team-config.ts";
import { isAgentKind, legacyDefaultAgent, resolveStep } from "./agents.ts";
import { isWebllmProfile } from "./webllm.ts";
import { computeSpend, extractUsage, mergePricing, ratesFor, usageFromText } from "./pricing.ts";
import {
  ensurePrintMode,
  explainCliFailure,
  formatKindlingTerminalTitle,
  isNoiseLog,
  readSession,
  resolveCursorModel,
  runAgentProcess,
  runProcess,
  sessionShouldStop,
  stageOutputFromLog,
  startInteractiveSession,
  startMacSession,
  tryCursorChatId,
  toInteractiveArgs,
  evaluateLongSessionPoll,
  ensureNotifyMcpSeenAt,
  notifyPostSucceeded,
  withCursorWorkspace,
  withNonInteractiveFlags,
  withoutFullAgentMode,
} from "./cli-session.ts";
import type { AgentKind, ExecutionConfig, StepAgent, TokenUsage } from "./types.ts";
import { clip, createLogger, startCall } from "./logger.ts";

export type ModelCall = {
  text: string;
  ok: boolean;
  via: string;
  error?: string;
  usage?: TokenUsage;
  spend?: number;
  sessionDir?: string;
  pending?: boolean;
};

function envStr(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function resolveExecution(client?: ExecutionConfig): ExecutionConfig {
  const base = { ...createDefaultExecution(), ...client };
  const fromLegacy = legacyDefaultAgent(client);
  const envKind = envStr("PIT_PROVIDER") ?? envStr("PIT_DEFAULT_AGENT");
  const defaultAgent: AgentKind = isAgentKind(envKind)
    ? envKind
    : (client?.defaultAgent ?? fromLegacy ?? base.defaultAgent);
  const envProfile = envStr("PIT_WEBLLM_PROFILE");
  const webllmProfile = isWebllmProfile(envProfile) ? envProfile : base.webllmProfile ?? "balanced";
  const webllmModelId = envStr("PIT_WEBLLM_MODEL") || base.webllmModelId || "";
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
    stageTimeoutMs: Number(envStr("PIT_STAGE_TIMEOUT_MS") || base.stageTimeoutMs) || 300000,
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
    claudeExtraArgs: envStr("PIT_CLAUDE_EXTRA_ARGS") || base.claudeExtraArgs || "",
    runInTerminal: envStr("PIT_RUN_IN_TERMINAL") === "0" ? false : envStr("PIT_RUN_IN_TERMINAL") === "1" ? true : base.runInTerminal !== false,
    fullAgentMode: envStr("PIT_FULL_AGENT") === "1" ? true : envStr("PIT_FULL_AGENT") === "0" ? false : Boolean(base.fullAgentMode),
    webllmProfile,
    webllmModelId,
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
  printMode = false,
  terminalTitle?: string,
): Promise<{ ok: boolean; text: string; error?: string; via: string; sessionDir?: string; pending?: boolean }> {
  const line = kind === "claude" ? exec.claudeCommand : exec.cursorCommand;
  const { bin, args } = parseCommand(line);
  const via = kind === "claude" ? "Claude" : "Cursor";
  const call = startCall("exec.cli", { kind, via, printMode });
  const found = kind === "cursor" ? await lookupCursorBin(bin) : await lookupBin(bin);
  if (!found) {
    const error = `${via} CLI \`${bin}\` is not on PATH. Install it, or set a local HTTP URL.`;
    call.fail(error, { bin });
    return { ok: false, text: "", via, error };
  }
  const cwd = workspaceOf(exec);
  let flags = withNonInteractiveFlags(
    kind,
    [...args, ...extraArgs],
    kind === "claude" ? exec.claudeExtraArgs : exec.cursorExtraArgs,
  );
  if (!exec.fullAgentMode) flags = withoutFullAgentMode(flags);
  if (kind === "cursor") flags = withCursorWorkspace(flags, cwd);
  const longStage =
    Boolean(exec.runInTerminal) && !printMode && Boolean(exec.fullAgentMode) && process.platform === "darwin";
  if (longStage) {
    flags = toInteractiveArgs(flags);
    if (kind === "claude" && !flags.includes("--session-id")) {
      flags = ["--session-id", crypto.randomUUID(), ...flags];
    }
    if (kind === "cursor" && !flags.includes("--resume")) {
      const chat = await tryCursorChatId(found, cwd);
      if (chat) flags = ["--resume", chat, ...flags];
    }
    call.log.debug("interactive", {
      bin: found,
      args: flags.join(" "),
      cwd,
      promptChars: prompt.length,
      prompt: clip(prompt),
      title: terminalTitle,
    });
    const session = await startInteractiveSession(
      cwd,
      found,
      flags,
      prompt,
      terminalTitle ? { title: terminalTitle } : undefined,
    );
    call.ok({ via: `${via} Terminal`, sessionDir: session.dir, pending: true });
    return {
      ok: true,
      text: "Long stage opened in Terminal. Answer any prompts there. Close the window when the agent is done — Kindling is tailing the log.",
      via: `${via} Terminal`,
      sessionDir: session.dir,
      pending: true,
    };
  }
  flags = exec.fullAgentMode ? flags : ensurePrintMode(flags);
  if (kind === "claude" && !flags.includes("--session-id")) {
    flags = ["--session-id", crypto.randomUUID(), ...flags];
  }
  call.log.debug("spawn", {
    bin: found,
    args: flags.join(" "),
    cwd,
    timeoutMs: timeoutMs ?? exec.stageTimeoutMs ?? exec.timeoutMs,
    inTerminal: Boolean(exec.runInTerminal),
    promptChars: prompt.length,
    prompt: clip(prompt),
  });
  const raw = await runAgentProcess({
    bin: found,
    args: flags,
    prompt,
    cwd,
    timeoutMs: timeoutMs ?? exec.stageTimeoutMs ?? exec.timeoutMs,
    inTerminal: Boolean(exec.runInTerminal),
    fullAgent: Boolean(exec.fullAgentMode),
    terminalTitle,
  });
  const body = stageOutputFromLog(raw.out || raw.err);
  const live = raw.via === "terminal" && body.length > 0;
  const resultVia = raw.via === "terminal" ? `${via} Terminal` : via;
  if ((raw.code === 0 && body) || live) {
    call.ok({ via: resultVia, chars: body.length, spawnVia: raw.via });
    return { ok: true, text: body, via: resultVia };
  }
  const timedOut = /timed out after/i.test(raw.err);
  const limit = timeoutMs ?? exec.stageTimeoutMs ?? exec.timeoutMs;
  const error = timedOut
    ? `Timed out after ${Math.round(limit / 60000)}m waiting for the agent. Rerun the stage, or raise the limit in Settings → Execution (Stage timeout).`
    : explainCliFailure(body || `exit ${raw.code}`);
  call.fail(error, { via: resultVia, code: raw.code, chars: body.length });
  return {
    ok: false,
    text: body,
    via: resultVia,
    error,
  };
}

async function callLocalCli(
  exec: ExecutionConfig,
  prompt: string,
  kind: "cursor" | "claude",
  terminalTitle?: string,
): Promise<ModelCall> {
  const result = await invokeCli(exec, kind, prompt, [], undefined, !exec.fullAgentMode, terminalTitle);
  if (result.pending && result.sessionDir) {
    return { ok: true, text: result.text, via: result.via, sessionDir: result.sessionDir, pending: true };
  }
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
  const call = startCall("exec.http", { kind, via, url: safeUrl(url), maxTokens });
  call.log.debug("prompt", { chars: system.length + user.length, prompt: clip(`${system}\n\n${user}`) });
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
      const error = `${via} ${res.status}: ${raw.slice(0, 400)}`;
      call.fail(error, { status: res.status });
      return { ok: false, text: "", via, error };
    }
    const text = extractModelText(json) || (typeof json === "string" ? json : "");
    if (!text.trim()) {
      call.fail(`${via} returned an empty body`, { status: res.status });
      return { ok: false, text: "", via, error: `${via} returned an empty body` };
    }
    call.ok({ status: res.status, chars: text.length });
    return { ok: true, text, via, usage: extractUsage(json) ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    call.fail(`${via}: ${message}`);
    return { ok: false, text: "", via, error: `${via}: ${message}` };
  }
}

async function callStudio(
  exec: ExecutionConfig,
  prompt: string,
  promptId: string,
): Promise<ModelCall> {
  const call = startCall("exec.http", { kind: "studio", via: "Studio", promptId });
  if (!exec.studioBaseUrl) {
    const error = "Set Studio base URL in Team → Execution.";
    call.fail(error);
    return { ok: false, text: "", via: "Studio", error };
  }
  if (!exec.featureKey) {
    const error = "Set wd-pca-feature-key (your user ID) in Team → Execution.";
    call.fail(error);
    return { ok: false, text: "", via: "Studio", error };
  }
  if (!promptId) {
    const error = "Set a GenAI Studio prompt ID.";
    call.fail(error);
    return { ok: false, text: "", via: "Studio", error };
  }
  const url = `${exec.studioBaseUrl}/v1alpha/prediction/cis/generate/${encodeURIComponent(promptId)}`;
  call.log.debug("request", { url: safeUrl(url), promptChars: prompt.length, prompt: clip(prompt) });
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
      const error = `Studio ${res.status}: ${raw.slice(0, 400)}`;
      call.fail(error, { status: res.status });
      return { ok: false, text: "", via: "Studio", error };
    }
    const text = extractModelText(json);
    if (!text) {
      call.fail("Studio returned no model text.", { status: res.status });
      return { ok: false, text: "", via: "Studio", error: "Studio returned no model text." };
    }
    call.ok({ status: res.status, chars: text.length });
    return { ok: true, text, via: "Studio", usage: extractUsage(json) ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    call.fail(`Studio: ${message}`);
    return { ok: false, text: "", via: "Studio", error: `Studio: ${message}` };
  }
}

async function callCis(
  exec: ExecutionConfig,
  prompt: string,
  maxTokens: number,
): Promise<ModelCall> {
  const call = startCall("exec.http", { kind: "cis", via: "CIS", maxTokens });
  if (!exec.studioBaseUrl) {
    const error = "Set Studio base URL in Team → Execution.";
    call.fail(error);
    return { ok: false, text: "", via: "CIS", error };
  }
  if (!exec.featureKey) {
    const error = "Set wd-pca-feature-key (your user ID) in Team → Execution.";
    call.fail(error);
    return { ok: false, text: "", via: "CIS", error };
  }
  const url = `${exec.studioBaseUrl}/cis/v1alpha1/predictions`;
  call.log.debug("request", { url: safeUrl(url), promptChars: prompt.length, prompt: clip(prompt), model: exec.cisModel });
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
      const error = `CIS ${res.status}: ${raw.slice(0, 400)}`;
      call.fail(error, { status: res.status });
      return { ok: false, text: "", via: "CIS", error };
    }
    const text = extractModelText(json);
    if (!text) {
      call.fail("CIS returned no model text.", { status: res.status });
      return { ok: false, text: "", via: "CIS", error: "CIS returned no model text." };
    }
    call.ok({ status: res.status, chars: text.length });
    return { ok: true, text, via: "CIS", usage: extractUsage(json) ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    call.fail(`CIS: ${message}`);
    return { ok: false, text: "", via: "CIS", error: `CIS: ${message}` };
  }
}

function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return clip(url, 120);
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
  const call = startCall("exec.http", { kind, via, url: safeUrl(url), maxTokens });
  call.log.debug("prompt", { chars: system.length + user.length, prompt: clip(`${system}\n\n${user}`) });
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
    if (!res.ok) {
      const error = `${via} ${res.status}: ${raw.slice(0, 400)}`;
      call.fail(error, { status: res.status });
      return { ok: false, text: "", via, error };
    }
    const text = extractModelText(json) || (typeof json === "string" ? json : "");
    if (!text.trim()) {
      call.fail(`${via} returned an empty body`, { status: res.status });
      return { ok: false, text: "", via, error: `${via} returned an empty body` };
    }
    call.ok({ status: res.status, chars: text.length });
    return { ok: true, text, via, usage: extractUsage(json) ?? undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    call.fail(`${via}: ${message}`);
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
  terminalTitle?: string;
}): Promise<ModelCall> {
  const exec = resolveExecution(opts.execution);
  const step = resolveStep({ agent: opts.stepAgent ?? "inherit" }, exec);
  const prompt = [opts.system, opts.user].filter(Boolean).join("\n\n");
  const promptId = opts.promptId || exec.promptId;
  const span = startCall("exec", {
    kind: step.kind,
    target: step.target,
    via: step.label,
    maxTokens: opts.maxTokens,
  });
  span.log.debug("prompt", { chars: prompt.length, prompt: clip(prompt), title: opts.terminalTitle });
  const cost = (result: ModelCall) => {
    const priced = attachCost(result, exec, step.kind, opts.system, opts.user);
    if (priced.ok) span.ok({ via: priced.via, chars: priced.text.length, pending: priced.pending, sessionDir: priced.sessionDir });
    else span.fail(priced.error || "empty response", { via: priced.via });
    return priced;
  };

  if (step.kind === "webllm") {
    return cost({
      ok: false,
      text: "",
      via: step.label,
      error: "WebLLM runs in this browser tab, not on the server. Pin the stage to WebLLM and run it from the board.",
    });
  }
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
  return cost(await callLocalCli(exec, prompt, kind, opts.terminalTitle));
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
    const hit = await locateBin(name, kind === "cursor");
    if (hit) {
      found = { ...hit, name };
      break;
    }
  }
  return { kind, bin, args, found };
}

async function pushCliChecks(checks: SetupCheck[], located: LocatedCli): Promise<boolean> {
  const via = located.kind === "claude" ? "Claude" : "Cursor";
  if (!located.found) {
    checks.push({
      ok: false,
      label: `${via} CLI`,
      detail: `\`${located.bin}\` was not on PATH or in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin. Install it, then restart npm run dev from Terminal.`,
    });
    return false;
  }
  const version = await runVersion(located.found.path);
  const real = (await realPathIfExists(located.found.path)) ?? located.found.path;
  const identity = classifyCliIdentity(real, version.text);
  if (located.kind === "cursor" && identity === "grok") {
    checks.push({
      ok: false,
      label: "Cursor CLI",
      detail: `Resolved to Grok (${located.found.path}${real !== located.found.path ? ` → ${real}` : ""}, ${version.text}). Kindling will skip this and look for cursor-agent.`,
    });
    return false;
  }
  if (located.found.name !== located.bin) {
    checks.push({
      ok: true,
      label: `${via} CLI`,
      detail: `Using \`${located.found.name}\` at ${located.found.path} (${identity}${version.text ? `, ${version.text}` : ""}). Configured command was \`${located.bin}\`.`,
    });
  } else if (!located.found.onPath) {
    checks.push({
      ok: true,
      label: `${via} CLI`,
      detail: `Found at ${located.found.path} (not on Node PATH). ${identity}${version.text ? ` · ${version.text}` : ""}`,
    });
  } else {
    checks.push({
      ok: true,
      label: `${via} CLI`,
      detail: `${located.found.path}${real !== located.found.path ? ` → ${real}` : ""} · ${identity}${version.text ? ` · ${version.text}` : ""}`,
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
      : resolveCursorModel(exec.cursorTestModel);
  const extra = model ? ["--model", model] : [];
  const result = await invokeCli(
    exec,
    located.kind,
    prompt,
    extra,
    Math.min(Math.max(exec.timeoutMs, 20000), 120000),
    true,
    formatKindlingTerminalTitle(`${via} test`),
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

async function probeMcp(
  kind: "cursor" | "claude",
  located: LocatedCli,
  exec: ExecutionConfig,
  server?: string,
): Promise<SetupCheck[]> {
  const via = kind === "claude" ? "Claude" : "Cursor";
  if (!located.found) {
    return [{ ok: false, label: `${via} MCP`, detail: `${via} CLI is not installed — cannot list MCP servers.` }];
  }
  const timeoutMs = exec.runInTerminal ? 90000 : 25000;
  const list = await runAgentProcess({
    bin: located.found.path,
    args: ["mcp", "list"],
    cwd: workspaceOf(exec),
    timeoutMs,
    inTerminal: Boolean(exec.runInTerminal),
  });
  const text = (list.out || list.err).slice(0, 1200);
  const checks: SetupCheck[] = [];
  const live = list.via === "terminal" && text.length > 10;
  if (list.code !== 0 && !text && !live) {
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
    ok: (list.code === 0 || live) && !failed,
    label: `${via} MCP list${exec.runInTerminal ? " · Terminal" : ""}`,
    detail: none ? "No MCP servers configured." : text || `exit ${list.code}`,
  });
  const name = server?.trim();
  if (name) {
    const get = await runAgentProcess({
      bin: located.found.path,
      args: ["mcp", "get", name],
      cwd: workspaceOf(exec),
      timeoutMs,
      inTerminal: Boolean(exec.runInTerminal),
    });
    const body = (get.out || get.err).slice(0, 800);
    const issue = /Issue:|Failed to connect|✘/i.test(body);
    const got = get.via === "terminal" && body.length > 10;
    checks.push({
      ok: (get.code === 0 || got) && !issue,
      label: `${via} MCP get ${name}${exec.runInTerminal ? " · Terminal" : ""}`,
      detail: body || `exit ${get.code}`,
    });
  }
  return checks;
}

async function lookupBin(bin: string): Promise<string | null> {
  const hit = await locateBin(bin);
  return hit?.path ?? null;
}

/** Grok Build TUI also ships as `agent` and now shadows Cursor on PATH. Never use it for Cursor stages. */
export function isGrokAgentPath(p: string): boolean {
  const n = p.replace(/\\/g, "/").toLowerCase();
  return n.includes("/.grok/") || n.includes("grok-macos") || n.includes("grok-linux") || n.includes("grok-windows");
}

async function realPathIfExists(candidate: string): Promise<string | null> {
  const { existsSync, realpathSync } = await import("node:fs");
  if (!existsSync(candidate)) return null;
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

async function locateBin(bin: string, skipGrok = false): Promise<{ path: string; onPath: boolean } | null> {
  const { delimiter, join } = await import("node:path");
  if (!bin) return null;
  const consider = async (candidate: string, onPath: boolean) => {
    const resolved = await realPathIfExists(candidate);
    if (!resolved) return null;
    if (skipGrok && (isGrokAgentPath(candidate) || isGrokAgentPath(resolved))) return null;
    return { path: candidate, onPath };
  };
  if (bin.includes("/") || bin.includes("\\")) {
    return consider(bin, true);
  }
  const pathDirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const hit = await consider(join(dir, bin), true);
    if (hit) return hit;
  }
  for (const dir of extraBinDirs()) {
    if (pathDirs.includes(dir)) continue;
    const hit = await consider(join(dir, bin), false);
    if (hit) return hit;
  }
  return null;
}

async function lookupCursorBin(configured: string): Promise<string | null> {
  const names = [configured, "cursor-agent", "agent", "cursor"].filter((n, i, all) => n && all.indexOf(n) === i);
  for (const name of names) {
    const hit = await locateBin(name, true);
    if (hit) return hit.path;
  }
  return null;
}

export type CliIdentity = "cursor" | "grok" | "claude" | "unknown" | "missing";

export type CliBinInfo = {
  configured: string;
  path: string | null;
  realPath: string | null;
  version: string;
  identity: CliIdentity;
};

export type CliInspectReport = {
  cursor: CliBinInfo;
  grokOnPath: CliBinInfo | null;
  claude: CliBinInfo;
};

export function classifyCliIdentity(path: string | null, version: string): CliIdentity {
  if (!path) return "missing";
  if (isGrokAgentPath(path) || /^grok\b/i.test(version)) return "grok";
  if (/cursor-agent/i.test(path) || /^\d{4}\.\d{2}\.\d{2}/.test(version)) return "cursor";
  if (/claude/i.test(path) || /^claude\b/i.test(version)) return "claude";
  return "unknown";
}

async function describeBin(configured: string, path: string | null): Promise<CliBinInfo> {
  const realPath = path ? ((await realPathIfExists(path)) ?? path) : null;
  const version = path ? (await runVersion(path)).text : "";
  return {
    configured,
    path,
    realPath: realPath && realPath !== path ? realPath : path,
    version,
    identity: classifyCliIdentity(realPath ?? path, version),
  };
}

export async function inspectCliBins(client?: ExecutionConfig): Promise<CliInspectReport> {
  const exec = resolveExecution(client);
  const cursorBin = parseCommand(exec.cursorCommand).bin;
  const claudeBin = parseCommand(exec.claudeCommand).bin;
  const cursorPath = await lookupCursorBin(cursorBin);
  const grokHit = await locateBin("agent", false);
  const grokPath =
    grokHit && isGrokAgentPath((await realPathIfExists(grokHit.path)) ?? grokHit.path) ? grokHit.path : null;
  const claudePath = await lookupBin(claudeBin);
  const cursor = await describeBin(exec.cursorCommand, cursorPath);
  const claude = await describeBin(exec.claudeCommand, claudePath);
  const grokOnPath =
    grokPath && grokPath !== cursorPath ? await describeBin("agent (PATH)", grokPath) : null;
  return { cursor, grokOnPath, claude };
}

async function runVersion(binPath: string): Promise<{ ok: boolean; text: string }> {
  const raw = await runProcess(binPath, ["--version"], 4000);
  const text = (raw.out || raw.err).trim();
  if (text) return { ok: true, text: text.split("\n")[0] || text };
  if (raw.code === 0) return { ok: true, text: "ok" };
  return { ok: false, text: text || `${binPath} --version timed out` };
}

const CURSOR_ALIASES = ["cursor-agent", "agent", "cursor"];
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

  if (step.kind === "webllm") {
    checks.push({
      ok: false,
      label: "WebLLM",
      detail: "In-browser WebGPU engine — use Test WebLLM in Settings. The server cannot run it.",
    });
    return { ok: false, via, text: "", error: "WebLLM is client-only", checks };
  }

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
    await pushCliChecks(checks, located);
    checks.push(...(await probeMcp(step.kind, located, exec, options.mcpServer)));
    if (mode === "run" && located.found) {
      const mcpPrompt =
        prompt && prompt !== "Reply with exactly: pong"
          ? prompt
          : "List the MCP servers and tools you have. Name each one. If a server needs auth, say so.";
      checks.push(await pingAgent(located, exec, mcpPrompt));
    }
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
    const present = await pushCliChecks(checks, located);
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

export async function startAgentTest(opts: {
  execution?: ExecutionConfig;
  stepAgent?: StepAgent;
  mode?: "connect" | "run";
  prompt?: string;
  mcp?: boolean;
  mcpServer?: string;
}): Promise<{
  ok: boolean;
  via: string;
  text: string;
  error?: string;
  checks: SetupCheck[];
  sessionDir?: string;
  log: string;
}> {
  const exec = resolveExecution(opts.execution);
  const span = startCall("exec.test", {
    stepAgent: opts.stepAgent ?? "inherit",
    mode: opts.mode ?? "connect",
    mcp: Boolean(opts.mcp),
  });
  const probe = await probeSetup(opts.execution, opts.stepAgent, {
    ...opts,
    mode: "connect",
  });
  if (opts.mode !== "run" && !opts.mcp) {
    if (probe.ok) span.ok({ via: probe.via, phase: "connect" });
    else span.fail(probe.error || probe.text, { via: probe.via, phase: "connect" });
    return { ...probe, log: probe.text };
  }
  const step = resolveStep({ agent: opts.stepAgent ?? "inherit" }, exec);
  if (step.kind !== "cursor" && step.kind !== "claude") {
    if (probe.ok) span.ok({ via: probe.via, kind: step.kind });
    else span.fail(probe.error || probe.text, { via: probe.via, kind: step.kind });
    return { ...probe, log: probe.text };
  }
  const located = await locateCli(step.kind, exec);
  if (!located.found) {
    span.fail(probe.error || `${step.label} CLI not found`, { via: probe.via });
    return { ...probe, log: probe.text };
  }
  const prompt = (opts.prompt || "Reply with exactly: pong").trim();
  const model =
    step.kind === "claude"
      ? exec.claudeTestModel?.trim() || "haiku"
      : resolveCursorModel(exec.cursorTestModel);
  let args: string[];
  let promptText: string | undefined;
  if (opts.mcp && (opts.mode !== "run" || Boolean(opts.mcpServer))) {
    args = opts.mcpServer?.trim() ? ["mcp", "get", opts.mcpServer.trim()] : ["mcp", "list"];
  } else {
    const extra = model ? ["--model", model] : [];
    let built = withNonInteractiveFlags(
      step.kind,
      [...located.args, ...extra],
      step.kind === "claude" ? exec.claudeExtraArgs : exec.cursorExtraArgs,
    );
    if (!exec.fullAgentMode) built = ensurePrintMode(withoutFullAgentMode(built));
    if (step.kind === "cursor") built = withCursorWorkspace(built, workspaceOf(exec));
    args = built;
    promptText = opts.mcp ? `List your MCP tools, then: ${prompt}` : prompt;
  }
  if (!exec.runInTerminal || process.platform !== "darwin") {
    const raw = await runAgentProcess({
      bin: located.found.path,
      args,
      prompt: promptText,
      cwd: workspaceOf(exec),
      timeoutMs: 25000,
      inTerminal: false,
      fullAgent: Boolean(exec.fullAgentMode),
    });
    const log = raw.out || raw.err;
    const ok = raw.code === 0 && !isNoiseLog(log);
    const checks = [
      ...probe.checks,
      {
        ok,
        label: opts.mcp ? `${step.label} MCP` : `${step.label} test run`,
        detail: ok ? log.slice(0, 800) : explainCliFailure(log || `exit ${raw.code}`),
      },
    ];
    span.log.debug("spawn", { bin: located.found.path, args: args.join(" "), code: raw.code });
    if (ok && probe.ok) span.ok({ via: step.label, chars: log.length });
    else span.fail(ok ? probe.error || probe.text : explainCliFailure(log), { via: step.label, code: raw.code });
    return {
      ok: ok && probe.ok,
      via: step.label,
      text: log.slice(0, 400),
      error: ok ? undefined : explainCliFailure(log),
      checks,
      log,
    };
  }
  span.log.debug("terminal", { bin: located.found.path, args: args.join(" ") });
  const session = await startMacSession(
    workspaceOf(exec),
    located.found.path,
    args,
    promptText,
    {
      title: formatKindlingTerminalTitle(opts.mcp ? `${step.label} MCP test` : `${step.label} test`),
    },
  );
  span.ok({ via: step.label, sessionDir: session.dir, pending: true });
  return {
    ok: probe.ok,
    via: step.label,
    text: "Terminal opened — streaming log…",
    checks: probe.checks,
    sessionDir: session.dir,
    log: `[kindling] session ${session.dir}\n[kindling] ${located.found.path} ${args.join(" ")}`,
  };
}

export async function pollAgentTest(
  sessionDir: string,
  opts?: { longSession?: boolean; columnId?: string; hasSlackMessage?: boolean },
): Promise<{
  done: boolean;
  ok: boolean;
  log: string;
  error?: string;
}> {
  const snap = await readSession(sessionDir);
  const age = Date.now() - snap.startedAt;
  const pollLog = createLogger("exec.poll", { sessionDir });
  if (sessionShouldStop(snap.log)) {
    const error = explainCliFailure(snap.log);
    pollLog.error("fail", { error, ageMs: age });
    return { done: true, ok: false, log: snap.log, error };
  }
  if (snap.exitCode !== null) {
    const ok = snap.exitCode === 0 && !isNoiseLog(snap.log);
    const error = ok ? undefined : explainCliFailure(snap.log) || `exit ${snap.exitCode}`;
    if (ok) pollLog.info("ok", { code: snap.exitCode, chars: snap.log.length, ageMs: age });
    else pollLog.error("fail", { error, code: snap.exitCode, ageMs: age });
    return {
      done: true,
      ok,
      log: snap.log,
      error,
    };
  }
  if (opts?.longSession) {
    let notifyMcpSeenAt: number | undefined;
    if (opts.columnId === "send-slack" && notifyPostSucceeded(snap.log)) {
      notifyMcpSeenAt = await ensureNotifyMcpSeenAt(sessionDir);
    }
    const verdict = evaluateLongSessionPoll(snap, {
      columnId: opts.columnId,
      hasSlackMessage: opts.hasSlackMessage,
      notifyMcpSeenAt,
    });
    if (verdict.done) {
      if (verdict.ok) pollLog.info("ok", { ageMs: age, chars: snap.log.length, columnId: opts.columnId });
      else pollLog.error("fail", { error: verdict.error, ageMs: age, columnId: opts.columnId });
      return { done: true, ok: verdict.ok, log: snap.log, error: verdict.error };
    }
    return { done: false, ok: true, log: snap.log };
  }
  if (age > 12000 && isNoiseLog(snap.log)) {
    const error =
      "Cursor stalled on retrieval (no model reply after 12s). That is the agent, not Kindling. Run `agent -p --trust -f 'Reply with exactly: pong'` in Terminal to confirm.";
    pollLog.error("fail", { error, ageMs: age });
    return {
      done: true,
      ok: false,
      log: snap.log,
      error,
    };
  }
  if (age > 40000) {
    const error = "Timed out after 40s. Check the Terminal window — Kindling will not wait forever.";
    pollLog.error("fail", { error, ageMs: age });
    return {
      done: true,
      ok: false,
      log: snap.log,
      error,
    };
  }
  return { done: false, ok: true, log: snap.log };
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
