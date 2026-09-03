import { setLogPersist, subscribeLogs } from "./logger";
import { appendAppLogs } from "./discovery-agent";

let started = false;
let stop: () => void = () => {};

/** Idempotent. Call before any WebLLM work so App log gets browser lines. */
export function ensureLogFlush(): void {
  if (typeof window === "undefined" || started) return;
  stop = startLogFlush();
}

/** Push browser (WebLLM) log lines into the server App log buffer. */
export function startLogFlush(): () => void {
  if (typeof window === "undefined") return () => {};
  started = true;
  let queued: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    timer = null;
    const batch = queued.splice(0);
    if (!batch.length) return;
    try {
      await appendAppLogs({ data: { lines: batch } });
    } catch {
      /* App log poll still shows the in-tab buffer */
    }
  }

  setLogPersist(async (lines) => {
    await appendAppLogs({ data: { lines } });
  });
  const unsub = subscribeLogs((rec) => {
    queued.push(rec.line);
    if (timer != null) return;
    timer = setTimeout(() => void flush(), 0);
  });
  const onHide = () => void flush();
  window.addEventListener("pagehide", onHide);
  return () => {
    started = false;
    setLogPersist(null);
    window.removeEventListener("pagehide", onHide);
    unsub();
    void flush();
  };
}
