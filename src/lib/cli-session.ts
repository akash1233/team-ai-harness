/** Non-interactive flags so Cursor/Claude do not block on a TTY trust prompt. */
export function withNonInteractiveFlags(
  kind: "cursor" | "claude",
  args: string[],
  extraLine = "",
): string[] {
  const extra = extraLine.trim().split(/\s+/).filter(Boolean);
  const defaults = kind === "cursor" ? ["--trust", "-f"] : [];
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

/** Drop print-mode flags so Terminal stays a live session, not one shot. */
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

/** Workday Claude blocks auto mode outside a dev container. */
export function withoutAutoMode(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dangerously-skip-permissions") continue;
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

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1B\][^\x07]*\x07/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

export function explainCliFailure(text: string): string {
  const plain = stripAnsi(text);
  if (/Auto mode is allowed only in dev containers|UserPromptSubmit operation blocked/i.test(plain)) {
    return "Workday Claude blocked auto mode (--permission-mode dontAsk). Kindling now runs print mode without auto. Answer any trust prompt in Terminal, then re-run.";
  }
  if (/Quick safety check|Is this a project you created/i.test(plain)) {
    return "Claude is waiting on the workspace trust prompt in Terminal. Type yes there, then re-run the test.";
  }
  if (/Workspace Trust Required|Do you trust the contents of this directory/i.test(plain)) {
    return "Cursor blocked on workspace trust. Kindling passes --trust -f. If Terminal still asks, confirm once.";
  }
  if (/permission|allow this|yes\/no/i.test(plain) && /claude/i.test(plain)) {
    return "Claude asked for permission in Terminal. Answer there — Kindling captures the log.";
  }
  return plain;
}

export function sessionShouldStop(text: string): boolean {
  const plain = stripAnsi(text);
  return /UserPromptSubmit operation blocked|Auto mode is allowed only in dev containers|Quick safety check|Workspace Trust Required|Do you trust the contents of this directory/i.test(
    plain,
  );
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
): Promise<{ dir: string; outFile: string; codeFile: string }> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kindling-"));
  const outFile = path.join(dir, "out.txt");
  const codeFile = path.join(dir, "code.txt");
  const script = path.join(dir, "run.command");
  const startedFile = path.join(dir, "started.txt");
  await fs.writeFile(startedFile, String(Date.now()));
  await fs.writeFile(outFile, `[kindling] ${new Date().toISOString()} starting\n[kindling] ${bin} ${args.join(" ")}\n`);
  const body = `#!/bin/bash
unset npm_config_prefix
unset NPM_CONFIG_PREFIX
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
set -o pipefail
cd ${shellQuote(cwd)}
echo "[kindling] $(date -u +%H:%M:%S) print session in $(pwd)" | tee -a ${shellQuote(outFile)}
${shellQuote(bin)} ${args.map(shellQuote).join(" ")} 2>&1 | tee -a ${shellQuote(outFile)}
echo $? > ${shellQuote(codeFile)}
echo "[kindling] $(date -u +%H:%M:%S) exit $(cat ${shellQuote(codeFile)})" | tee -a ${shellQuote(outFile)}
`;
  await fs.writeFile(script, body, { mode: 0o755 });
  const opened = await runProcess("open", ["-g", "-a", "Terminal", script], 8000);
  if (opened.code !== 0 && opened.err) {
    await fs.writeFile(codeFile, "1");
    await fs.appendFile(outFile, `\n[kindling] failed to open Terminal: ${opened.err}\n`);
  }
  return { dir, outFile, codeFile };
}

export async function readSession(dir: string): Promise<{
  log: string;
  exitCode: number | null;
  startedAt: number;
}> {
  const path = await import("node:path");
  const raw = await readIfExists(path.join(dir, "out.txt"));
  const codeText = await readIfExists(path.join(dir, "code.txt"));
  const started = Number(await readIfExists(path.join(dir, "started.txt"))) || Date.now();
  return {
    log: stripAnsi(raw),
    exitCode: codeText === "" ? null : Number(codeText),
    startedAt: started,
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
): Promise<{ code: number | null; out: string; err: string }> {
  const { dir } = await startMacSession(cwd, bin, args);
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
}): Promise<{ code: number | null; out: string; err: string; via: "terminal" | "spawn" }> {
  const args = withoutAutoMode(opts.args);
  if (opts.inTerminal && process.platform === "darwin") {
    const r = await runInMacTerminal(opts.cwd, opts.bin, args, opts.timeoutMs);
    return { ...r, out: stripAnsi(r.out), err: stripAnsi(r.err), via: "terminal" };
  }
  const r = await runProcess(opts.bin, args, opts.timeoutMs, opts.cwd);
  return { ...r, out: stripAnsi(r.out), err: stripAnsi(r.err), via: "spawn" };
}
