import { useEffect } from "react";
import { useBoardStore } from "@/lib/board-store";
import { SEND_SLACK_COLUMN_ID } from "@/lib/columns";
import { extractNotifyMcpResult } from "@/lib/discovery-slack";
import { testExecution } from "@/lib/discovery-agent";

/** Tails long Terminal stages and harvests when the window exits. */
export function StageSessionWatcher() {
  const tickets = useBoardStore((s) => s.tickets);
  const patchLiveLog = useBoardStore((s) => s.patchLiveLog);
  const harvestLiveSession = useBoardStore((s) => s.harvestLiveSession);
  const live = tickets.filter((t) => t.sessionDir && t.status === "executing");
  const key = live.map((t) => t.sessionDir).join("|");

  useEffect(() => {
    if (!key) return;
    let stop = false;
    async function tick() {
      const current = useBoardStore.getState().tickets.filter((t) => t.sessionDir && t.status === "executing");
      for (const t of current) {
        if (!t.sessionDir) continue;
        try {
          const poll = await testExecution({
            data: {
              phase: "poll",
              sessionDir: t.sessionDir,
              longSession: true,
              columnId: t.columnId,
              hasSlackMessage: Boolean(t.vars?.slackMessage?.trim()),
            },
          });
          if (stop) return;
          if (poll.log) {
            if (t.columnId === SEND_SLACK_COLUMN_ID) {
              const mcp = extractNotifyMcpResult(poll.log);
              patchLiveLog(t.id, mcp.found ? mcp.display : poll.log);
            } else {
              patchLiveLog(t.id, poll.log);
            }
          }
          if (poll.done) {
            await harvestLiveSession(t.id, { ok: Boolean(poll.ok), log: poll.log || "", error: poll.error });
          }
        } catch {
          /* keep polling */
        }
      }
    }
    const id = setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [key, harvestLiveSession, patchLiveLog]);

  return null;
}
