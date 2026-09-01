import { extractNotifyMcpResult } from "./discovery-slack.ts";

/** Non-interactive flags so Cursor/Claude do not block on a TTY trust prompt. */
export function withNonInteractiveFlags(
  kind: "cursor" | "claude",
  args: string[],
  extraLine = "",
): string[] {
  const extra = extraLine.trim().split(/\s+/).filter(Boolean);
  const defaults = kind === "cursor" ? [] : ["--permission-mode", "default"];
  const add = extra.length ? extra : defaults;
  const have = new Set(args);
  const missing: string[] = [];
  for (let i = 0; i < add.length; i++) {
    const token = add[i]!;
    if (have.has(token)) {
      if (add[i + 1] && !add[i + 1]!.startsWith("-")) i += 1;
      continue;
    }
    missing.push(token);
    have.add(token);
  }
  return [...missing, ...args];
}

export function ensurePrintMode(args: string[]): string[] {
  if (args.includes("-p") || args.includes("--print")) return args;
  return ["-p", "--output-format", "text", ...args];
}
export function toInteractiveArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-p" || a === "--print") continue;
    if (a === "--output-format" || a === "-o") {
      i += 1;
      continue;
    }
    if (a.startsWith("--output-format=")) continue;
    out.push(a);
  }
  return out;
}

/** Workday: full agent / auto is blocked. Print + ask only. */
export function withoutFullAgentMode(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (
      a === "--dangerously-skip-permissions" ||
      a === "--yolo" ||
      a === "-f" ||
      a === "--force" ||
      a === "--approve-mcps"
    ) {
      continue;
    }
    if (a === "--permission-mode") {
      const next = args[i + 1] || "";
      if (/dontAsk|bypassPermissions|auto/i.test(next)) {
        i += 1;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

/** @deprecated use withoutFullAgentMode */
export function withoutAutoMode(args: string[]): string[] {
  return withoutFullAgentMode(args);
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1B\][^\x07]*\x07/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

export function stageOutputFromLog(log: string): string {
  return stripAnsi(log)
    .split("\n")
    .filter(
      (l) =>
        !/^\[kindling\]/i.test(l) &&
        !/^cursor-retrieval:/i.test(l) &&
        !/^nvm is not compatible/i.test(l) &&
        !/^Run `unset/i.test(l) &&
        !/^Kindling /i.test(l),
    )
    .join("\n")
    .trim();
}

export function resolveCursorModel(raw?: string): string {
  const m = (raw || "").trim();
  if (!m || /^composer-1(\.|$)/i.test(m) || m === "composer-1") return "auto";
  return m;
}

export function withCursorWorkspace(args: string[], workspace: string): string[] {
  if (!workspace || args.includes("--workspace")) return args;
  return ["--workspace", workspace, ...args];
}

export function explainCliFailure(text: string): string {
  const plain = stripAnsi(text);
  if (/Cannot use this model:\s*(\S+)/i.test(plain)) {
    const hit = plain.match(/Cannot use this model:\s*(\S+)/i)?.[1];
    return `Cursor rejected model ${hit}. Kindling now defaults to auto. Set Test model to auto, composer-2.5, or gpt-5.4-nano-low.`;
  }
  if (/Auto mode is allowed only in dev containers|UserPromptSubmit operation blocked/i.test(plain)) {
    return "Workday Claude blocked auto mode (--permission-mode dontAsk). Kindling now runs print mode without auto. Answer any trust prompt in Terminal, then re-run.";
  }
  if (/Quick safety check|Is this a project you created/i.test(plain)) {
    return "Claude is waiting on the workspace trust prompt in Terminal. Type yes there, then re-run the test.";
  }
  if (/Workspace Trust Required|Do you trust the contents of this directory/i.test(plain)) {
    return "Cursor blocked on workspace trust. Confirm once in Terminal. Kindling does not pass --force; permissions come from .cursor/permissions.json.";
  }
  if (/permission|allow this|yes\/no/i.test(plain) && /claude/i.test(plain)) {
    return "Claude asked for permission in Terminal. Answer there — Kindling captures the log.";
  }
  return plain;
}

export function sessionShouldStop(text: string): boolean {
  const plain = stripAnsi(text);
  return /UserPromptSubmit operation blocked|Auto mode is allowed only in dev containers|Quick safety check|Workspace Trust Required|Do you trust the contents of this directory|Cannot use this model/i.test(
    plain,
  );
}

export const LONG_SESSION_HARD_CAP_MS = 45 * 60 * 1000;
export const LONG_SESSION_IDLE_MS = 20_000;
export const NOTIFY_MCP_SETTLE_MS = 15_000;

/** Notify auto-harvest delay after MCP success keywords (ms). Override via PIT_NOTIFY_MCP_SETTLE_MS. */
export function notifyMcpSettleMs(): number {
  const raw = process.env.PIT_NOTIFY_MCP_SETTLE_MS?.trim();
  if (!raw) return NOTIFY_MCP_SETTLE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : NOTIFY_MCP_SETTLE_MS;
}

export function sessionExitLineInLog(log: string): boolean {
  return /\[kindling\] exit \d+/.test(stripAnsi(log));
}

/** Heuristic: Cursor agent likely posted via slack-mcp slack_write. */
export function notifyPostSucceeded(log: string): boolean {
  return extractNotifyMcpResult(log).found;
}

export type SessionSnap = {
  log: string;
  exitCode: number | null;
  startedAt: number;
  mtimeMs?: number;
};

export function evaluateLongSessionPoll(
  snap: SessionSnap,
  opts?: { columnId?: string; hasSlackMessage?: boolean; notifyMcpSeenAt?: number },
): { done: boolean; ok: boolean; error?: string } {
  const age = Date.now() - snap.startedAt;
  const log = snap.log;

  if (sessionShouldStop(log)) {
    return { done: true, ok: false, error: explainCliFailure(log) };
  }
  if (snap.exitCode !== null) {
    const ok = snap.exitCode === 0 && !isNoiseLog(log);
    return {
      done: true,
      ok,
      error: ok ? undefined : explainCliFailure(log) || `exit ${snap.exitCode}`,
    };
  }
  if (sessionExitLineInLog(log)) {
    const code = Number(log.match(/\[kindling\] exit (\d+)/)?.[1] ?? 0);
    const ok = code === 0 && !isNoiseLog(log);
    return {
      done: true,
      ok,
      error: ok ? undefined : explainCliFailure(log) || `exit ${code}`,
    };
  }
  if (notifyPostSucceeded(log)) {
    if (opts?.columnId === "send-slack" && opts.notifyMcpSeenAt !== undefined) {
      if (Date.now() - opts.notifyMcpSeenAt < notifyMcpSettleMs()) {
        return { done: false, ok: true };
      }
    }
    return { done: true, ok: true };
  }

  const mtime = snap.mtimeMs ?? snap.startedAt;
  const idle = Date.now() - mtime > LONG_SESSION_IDLE_MS;

  if (opts?.columnId !== "send-slack" && idle && log.length > 200 && !isNoiseLog(log)) {
    return { done: true, ok: true };
  }
  if (age > LONG_SESSION_HARD_CAP_MS) {
    return {
      done: true,
      ok: false,
      error: "Terminal session exceeded 45 minutes — click Done to harvest or re-run.",
    };
  }
  return { done: false, ok: true };
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatKindlingTerminalTitle(label: string): string {
  return `Kindling — ${label}`;
}

export function sanitizeTerminalScriptName(title: string): string {
  const clean = title
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[/\\]/g, "-")
    .trim();
  const name = clean || "run";
  return name.length > 60 ? name.slice(0, 60).trim() : name;
}

export function bashSetTerminalTitle(title: string): string {
  return `printf '\\033]0;%s\\007' ${shellQuote(title)}`;
}

export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.npm_config_prefix;
  delete env.npm_config_loglevel;
  delete env.NPM_CONFIG_PREFIX;
  return env;
}

export async function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ code: number | null; out: string; err: string }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null, out: string, err: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out: out.trim(), err: err.trim() });
    };
    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn(bin, args, {
        cwd: cwd || process.cwd(),
        env: cleanEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      finish(1, "", err instanceof Error ? err.message : String(err));
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(1, out, err || `${bin} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => finish(1, out, e.message));
    child.on("close", (code) => finish(code, out, err));
  });
}

export async function readIfExists(file: string): Promise<string> {
  const fs = await import("node:fs/promises");
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return "";
  }
}

/** Records when Notify MCP success keywords first appeared in a Terminal session. */
export async function ensureNotifyMcpSeenAt(sessionDir: string): Promise<number> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const file = path.join(sessionDir, "notify-mcp-seen.txt");
  const existing = await readIfExists(file);
  if (existing) return Number(existing) || Date.now();
  const now = Date.now();
  await fs.writeFile(file, String(now));
  return now;
}

export function isNoiseLog(log: string): boolean {
  const lines = stripAnsi(log)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Kindling/i.test(l) && !/nvm is not compatible/i.test(l) && !/^Run `unset/i.test(l));
  if (!lines.length) return true;
  return lines.every((l) => /cursor-retrieval: tracing/i.test(l));
}

export async function startMacSession(
  cwd: string,
  bin: string,
  args: string[],
  prompt?: string,
  opts?: { title?: string },
): Promise<{ dir: string; outFile: string; codeFile: string }> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kindling-"));
  const outFile = path.join(dir, "out.txt");
  const codeFile = path.join(dir, "code.txt");
  const scriptName = opts?.title ? `${sanitizeTerminalScriptName(opts.title)}.command` : "run.command";
  const script = path.join(dir, scriptName);
  const promptFile = path.join(dir, "prompt.md");
  const startedFile = path.join(dir, "started.txt");
  await fs.writeFile(startedFile, String(Date.now()));
  const promptArg = prompt !== undefined ? ` "$(cat ${shellQuote(promptFile)})"` : "";
  if (prompt !== undefined) await fs.writeFile(promptFile, prompt);
  await fs.writeFile(
    outFile,
    `[kindling] ${new Date().toISOString()} starting\n[kindling] cwd ${cwd}\n[kindling] ${bin} ${args.join(" ")}${prompt !== undefined ? " $(cat prompt.md)" : ""}\n${prompt !== undefined ? `[kindling] prompt: ${prompt.slice(0, 240).replace(/\n/g, " ")}\n` : ""}`,
  );
  const titleLine = opts?.title ? `${bashSetTerminalTitle(opts.title)}\n` : "";
  const body = `#!/bin/bash
unset npm_config_prefix
unset NPM_CONFIG_PREFIX
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
${titleLine}set -o pipefail
trap 'ec=$?; echo $ec > ${codeFile}; echo "[kindling] exit $ec" | tee -a ${outFile}' EXIT
cd ${shellQuote(cwd)}
echo "[kindling] $(date -u +%H:%M:%S) print session in $(pwd)" | tee -a ${shellQuote(outFile)}
${shellQuote(bin)} ${args.map(shellQuote).join(" ")}${promptArg} 2>&1 | tee -a ${shellQuote(outFile)}
`;
  await fs.writeFile(script, body, { mode: 0o755 });
  const opened = await runProcess("open", ["-g", "-a", "Terminal", script], 8000);
  if (opened.code !== 0 && opened.err) {
    await fs.writeFile(codeFile, "1");
    await fs.appendFile(outFile, `\n[kindling] failed to open Terminal: ${opened.err}\n`);
  }
  return { dir, outFile, codeFile };
}

export async function readSession(dir: string): Promise<SessionSnap> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const outPath = path.join(dir, "out.txt");
  const raw = await readIfExists(outPath);
  const codeText = await readIfExists(path.join(dir, "code.txt"));
  const started = Number(await readIfExists(path.join(dir, "started.txt"))) || Date.now();
  let mtimeMs = started;
  try {
    mtimeMs = (await fs.stat(outPath)).mtimeMs;
  } catch {
    /* no log yet */
  }
  return {
    log: stripAnsi(raw),
    exitCode: codeText === "" ? null : Number(codeText),
    startedAt: started,
    mtimeMs,
  };
}

/**
 * Open Terminal.app and tee print-mode stdout into a log Kindling reads.
 */
export async function runInMacTerminal(
  cwd: string,
  bin: string,
  args: string[],
  timeoutMs: number,
  prompt?: string,
  terminalTitle?: string,
): Promise<{ code: number | null; out: string; err: string }> {
  const { dir } = await startMacSession(cwd, bin, args, prompt, terminalTitle ? { title: terminalTitle } : undefined);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await readSession(dir);
    if (sessionShouldStop(snap.log)) {
      return { code: 1, out: snap.log, err: explainCliFailure(snap.log) };
    }
    if (snap.exitCode !== null) {
      return { code: snap.exitCode, out: snap.log, err: "" };
    }
    if (Date.now() - snap.startedAt > 15000 && isNoiseLog(snap.log)) {
      return {
        code: 1,
        out: snap.log,
        err: "Cursor only printed a retrieval trace — no model reply. That is Cursor stalling, not Kindling. Try Test again, or run the same command in Terminal yourself.",
      };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const snap = await readSession(dir);
  if (snap.log.length > 20 && !isNoiseLog(snap.log) && !sessionShouldStop(snap.log)) {
    return { code: 0, out: snap.log, err: "" };
  }
  return { code: 1, out: snap.log, err: explainCliFailure(snap.log) || "Timed out waiting for the Terminal session." };
}

export async function runAgentProcess(opts: {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  inTerminal: boolean;
  fullAgent?: boolean;
  prompt?: string;
  terminalTitle?: string;
}): Promise<{ code: number | null; out: string; err: string; via: "terminal" | "spawn" }> {
  const args = opts.fullAgent ? opts.args : withoutFullAgentMode(opts.args);
  if (opts.inTerminal && process.platform === "darwin") {
    const r = await runInMacTerminal(
      opts.cwd,
      opts.bin,
      args,
      opts.timeoutMs,
      opts.prompt,
      opts.terminalTitle,
    );
    return { ...r, out: stripAnsi(r.out), err: stripAnsi(r.err), via: "terminal" };
  }
  const argv = opts.prompt !== undefined ? [...args, opts.prompt] : args;
  const r = await runProcess(opts.bin, argv, opts.timeoutMs, opts.cwd);
  return { ...r, out: stripAnsi(r.out), err: stripAnsi(r.err), via: "spawn" };
}

/**
 * Long pipeline stage: `script -q -F` gives Claude/Cursor a TTY so the TUI
 * renders and the operator can answer prompts. Kindling tails the capture file.
 */
export async function startInteractiveSession(
  cwd: string,
  bin: string,
  args: string[],
  prompt: string,
  opts?: { title?: string },
): Promise<{ dir: string; outFile: string; codeFile: string }> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kindling-stage-"));
  const outFile = path.join(dir, "out.txt");
  const codeFile = path.join(dir, "code.txt");
  const promptFile = path.join(dir, "prompt.md");
  const scriptName = opts?.title ? `${sanitizeTerminalScriptName(opts.title)}.command` : "run.command";
  const script = path.join(dir, scriptName);
  await fs.writeFile(path.join(dir, "started.txt"), String(Date.now()));
  await fs.writeFile(promptFile, prompt);
  await fs.writeFile(
    outFile,
    `[kindling] ${new Date().toISOString()} long stage\n[kindling] ${bin} ${args.join(" ")} $(cat prompt.md)\n`,
  );
  const inner = `cd ${shellQuote(cwd)} && ${shellQuote(bin)} ${args.map(shellQuote).join(" ")} "$(cat ${shellQuote(promptFile)})"`;
  const titleLine = opts?.title ? `${bashSetTerminalTitle(opts.title)}\n` : "";
  const body = `#!/bin/bash
unset npm_config_prefix
unset NPM_CONFIG_PREFIX
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
${titleLine}trap 'ec=$?; echo $ec > ${codeFile}; echo "[kindling] exit $ec" | tee -a ${outFile}' EXIT
cd ${shellQuote(cwd)}
echo "[kindling] $(date -u +%H:%M:%S) interactive stage — answer prompts here. Close when done." | tee -a ${shellQuote(outFile)}
script -q -F ${shellQuote(outFile)} /bin/bash -c ${shellQuote(inner)}
`;
  await fs.writeFile(script, body, { mode: 0o755 });
  const opened = await runProcess("open", ["-g", "-a", "Terminal", script], 8000);
  if (opened.code !== 0 && opened.err) {
    await fs.writeFile(codeFile, "1");
    await fs.appendFile(outFile, `\n[kindling] failed to open Terminal: ${opened.err}\n`);
  }
  return { dir, outFile, codeFile };
}

export async function tryCursorChatId(bin: string, cwd: string): Promise<string | undefined> {
  const raw = await runProcess(bin, ["create-chat"], 12000, cwd);
  const text = `${raw.out}\n${raw.err}`;
  const hit = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return hit?.[0];
}

