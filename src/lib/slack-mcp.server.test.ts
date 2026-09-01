import assert from "node:assert/strict";
import { test } from "node:test";
import { postSlackMessage, slackMcpDaemonPaths } from "./slack-mcp.server.ts";

test("slackMcpDaemonPaths resolves macOS default root", () => {
  const paths = slackMcpDaemonPaths();
  assert.match(paths.socketPath, /slack-mcp\/daemon\.sock$/);
  assert.match(paths.tokenPath, /slack-mcp\/daemon\.token$/);
});

test("postSlackMessage maps not_authenticated to a blocked-style error", async () => {
  const result = await postSlackMessage({
    channelId: "C1",
    text: "hi",
    request: async () => ({ ok: false, error: "not_authenticated" }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /slack_login/);
});

test("postSlackMessage returns channel and ts on success", async () => {
  const result = await postSlackMessage({
    channelId: "C9",
    text: "agenda",
    request: async (_op, fields) => {
      assert.equal(fields.method, "chat.postMessage");
      assert.deepEqual(fields.params, { channel: "C9", text: "agenda" });
      return { ok: true, channel: "C9", ts: "99.1" };
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.channel, "C9");
  assert.equal(result.ts, "99.1");
});
