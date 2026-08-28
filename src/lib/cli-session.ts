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

export function explainCliFailure(text: string): string {
  if (/Workspace Trust Required|Do you trust the contents of this directory/i.test(text)) {
    return "Cursor blocked on workspace trust (no TTY). Kindling passes --trust -f for print mode. Re-run, or enable Open Terminal.app so you can confirm the session.";
  }
  if (/permission|allow this|yes\/no/i.test(text) && /claude/i.test(text)) {
    return "Claude asked for permission interactively. Kindling passes --permission-mode dontAsk for print mode. Re-run, or enable Open Terminal.app.";
  }
  return text;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
        env: process.env,
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
set +e
cd ${shellQuote(cwd)}
echo "Kindling → ${bin} ${args.filter((a, i) => i === 0 || args[i - 1] !== "--model").slice(0, 6).join(" ")} …"
${shellQuote(bin)} ${args.map(shellQuote).join(" ")} > ${shellQuote(outFile)} 2>&1
echo $? > ${shellQuote(codeFile)}
echo
echo "Kindling: session finished. You can close this window."
`;
  await fs.writeFile(script, body, { mode: 0o755 });
  const opened = await runProcess("open", ["-g", "-a", "Terminal", script], 8000);
  if (opened.code !== 0 && !opened.out) {
    return { code: 1, out: "", err: opened.err || "Could not open Terminal.app" };
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const codeText = (await fs.readFile(codeFile, "utf8")).trim();
      if (codeText !== "") {
        const out = await fs.readFile(outFile, "utf8").catch(() => "");
        return { code: Number(codeText), out: out.trim(), err: "" };
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  const out = await fs.readFile(outFile, "utf8").catch(() => "");
  return { code: 1, out: out.trim(), err: "Timed out waiting for the Terminal session to finish." };
}

export async function runAgentProcess(opts: {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  inTerminal: boolean;
}): Promise<{ code: number | null; out: string; err: string; via: "terminal" | "spawn" }> {
  if (opts.inTerminal && process.platform === "darwin") {
    const r = await runInMacTerminal(opts.cwd, opts.bin, opts.args, opts.timeoutMs);
    return { ...r, via: "terminal" };
  }
  const r = await runProcess(opts.bin, opts.args, opts.timeoutMs, opts.cwd);
  return { ...r, via: "spawn" };
}
