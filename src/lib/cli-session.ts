/** Non-interactive flags so Cursor/Claude do not block on a TTY trust prompt. */
export function withNonInteractiveFlags(
  kind: "cursor" | "claude",
  args: string[],
  extraLine = "",
): string[] {
  const extra = extraLine.trim().split(/\s+/).filter(Boolean);
  const defaults = kind === "cursor" ? ["--trust", "-f"] : ["--permission-mode", "dontAsk"];
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

export function explainCliFailure(text: string): string {
  if (/Workspace Trust Required|Do you trust the contents of this directory/i.test(text)) {
    return "Cursor blocked on workspace trust (no TTY). Kindling passes --trust -f and opens Terminal as a live session.";
  }
  if (/permission|allow this|yes\/no/i.test(text) && /claude/i.test(text)) {
    return "Claude asked for permission. Answer in the Terminal window — Kindling is capturing the log.";
  }
  return text;
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

/**
 * Open Terminal.app as a live TTY (`script` records it). Kindling tails the log.
 * Does not steal the agent's stdout — you talk in that window.
 */
export async function runInMacTerminal(
  cwd: string,
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; out: string; err: string }> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kindling-"));
  const outFile = path.join(dir, "out.txt");
  const codeFile = path.join(dir, "code.txt");
  const script = path.join(dir, "run.command");
  const body = `#!/bin/bash
unset npm_config_prefix
unset NPM_CONFIG_PREFIX
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
set +e
cd ${shellQuote(cwd)}
echo "Kindling live session — talk to the agent here. Close this window when finished."
echo "Log is also captured in the Kindling app."
echo
script -q ${shellQuote(outFile)} ${shellQuote(bin)} ${args.map(shellQuote).join(" ")}
echo $? > ${shellQuote(codeFile)}
echo
echo "Kindling captured the log. You can close this window."
`;
  await fs.writeFile(script, body, { mode: 0o755 });
  const opened = await runProcess("open", ["-g", "-a", "Terminal", script], 8000);
  if (opened.code !== 0 && !opened.out && opened.err) {
    return { code: 1, out: "", err: opened.err || "Could not open Terminal.app" };
  }
  const start = Date.now();
  let lastLen = 0;
  let stable = 0;
  while (Date.now() - start < timeoutMs) {
    const codeText = await readIfExists(codeFile);
    const out = await readIfExists(outFile);
    if (codeText !== "") {
      return { code: Number(codeText), out, err: "" };
    }
    if (out.length > lastLen) {
      lastLen = out.length;
      stable = 0;
    } else if (out.length > 80) {
      stable += 1;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const out = await readIfExists(outFile);
  if (out.length > 40) {
    return { code: 0, out, err: "Session still open in Terminal — Kindling captured the log so far." };
  }
  return { code: 1, out, err: "Timed out waiting for the Terminal session. Leave the window open and talk to the agent; Kindling tails the log." };
}

export async function runAgentProcess(opts: {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  inTerminal: boolean;
}): Promise<{ code: number | null; out: string; err: string; via: "terminal" | "spawn" }> {
  if (opts.inTerminal && process.platform === "darwin") {
    const r = await runInMacTerminal(opts.cwd, opts.bin, toInteractiveArgs(opts.args), opts.timeoutMs);
    return { ...r, via: "terminal" };
  }
  const r = await runProcess(opts.bin, opts.args, opts.timeoutMs, opts.cwd);
  return { ...r, via: "spawn" };
}
