import { createConnection } from "node:net";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type SlackMcpPaths = {
  socketPath: string;
  tokenPath: string;
};

export type SlackMcpCallResult =
  | { ok: true; channel?: string; ts?: string; raw: Record<string, unknown> }
  | { ok: false; error: string; detail?: string };

/** Matches slack-mcp config.py: DAEMON_* live next to the profile dir parent. */
export function slackMcpDaemonPaths(): SlackMcpPaths {
  const profileOverride = process.env.SLACK_MCP_PROFILE_DIR?.trim();
  const root = profileOverride
    ? resolve(profileOverride, "..")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "slack-mcp")
      : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "slack-mcp");
  return {
    socketPath: join(root, "daemon.sock"),
    tokenPath: join(root, "daemon.token"),
  };
}

async function readDaemonToken(tokenPath: string): Promise<string> {
  try {
    return (await readFile(tokenPath, "utf8")).trim();
  } catch {
    return "";
  }
}

function readJsonLine(buffer: string, chunk: Buffer): { lines: string[]; rest: string } {
  const rest = buffer + chunk.toString("utf8");
  const parts = rest.split("\n");
  return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] ?? "" };
}

/** One-shot request to the slack-mcp browser daemon (see slack-mcp daemon_client.py). */
export async function slackMcpDaemonRequest(
  op: string,
  fields: Record<string, unknown>,
  paths: SlackMcpPaths = slackMcpDaemonPaths(),
): Promise<Record<string, unknown>> {
  const auth = await readDaemonToken(paths.tokenPath);
  const payload = JSON.stringify({ op, auth, ...fields }) + "\n";

  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(paths.socketPath);
    let pending = "";
    let settled = false;

    const finish = (result: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(result);
    };

    socket.setTimeout(120_000);
    socket.on("timeout", () => {
      finish({ ok: false, error: "timeout", detail: "slack-mcp daemon did not respond in time" });
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      const detail =
        err.code === "ENOENT" || err.code === "ECONNREFUSED"
          ? "slack-mcp daemon not running — use slack_login in Cursor once, then retry"
          : err.message;
      finish({ ok: false, error: "daemon_unavailable", detail });
    });
    socket.on("data", (chunk) => {
      const parsed = readJsonLine(pending, chunk);
      pending = parsed.rest;
      for (const line of parsed.lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line) as { event?: string; result?: Record<string, unknown> };
          if (message.event === "done") {
            finish(message.result ?? { ok: false, error: "daemon_disconnected" });
            return;
          }
        } catch {
          finish({ ok: false, error: "bad_response", detail: line.slice(0, 200) });
          return;
        }
      }
    });
    socket.on("end", () => {
      finish({ ok: false, error: "daemon_disconnected" });
    });
    socket.on("connect", () => {
      socket.write(payload);
    });
  });
}

export async function postSlackMessage(opts: {
  channelId: string;
  text: string;
  paths?: SlackMcpPaths;
  request?: typeof slackMcpDaemonRequest;
}): Promise<SlackMcpCallResult> {
  const request = opts.request ?? slackMcpDaemonRequest;
  const result = await request(
    "call",
    {
      method: "chat.postMessage",
      params: { channel: opts.channelId, text: opts.text },
    },
    opts.paths,
  );

  if (result.ok === false || result.error) {
    const error = String(result.error ?? "post_failed");
    if (error === "not_authenticated" || error === "invalid_auth") {
      return {
        ok: false,
        error: "slack-mcp session expired — run slack_login in Cursor, then retry",
        detail: typeof result.detail === "string" ? result.detail : undefined,
      };
    }
    return {
      ok: false,
      error,
      detail: typeof result.detail === "string" ? result.detail : JSON.stringify(result).slice(0, 300),
    };
  }

  const channel = typeof result.channel === "string" ? result.channel : opts.channelId;
  const ts = typeof result.ts === "string" ? result.ts : undefined;
  return { ok: true, channel, ts, raw: result };
}
