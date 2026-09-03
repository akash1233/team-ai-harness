import { useEffect, useState } from "react";
import {
  getWebllmRuntime,
  subscribeWebllmRuntime,
  webllmPublicStatus,
  type WebllmRuntimeState,
} from "@/lib/webllm-runtime";

function useWebllmRuntime(): WebllmRuntimeState {
  const [state, setState] = useState(getWebllmRuntime);
  useEffect(() => subscribeWebllmRuntime(() => setState(getWebllmRuntime())), []);
  return state;
}

export function WebllmStatusBar() {
  const { active, queue } = useWebllmRuntime();
  if (!active && queue.length === 0) return null;

  const status = webllmPublicStatus(active);
  const stage = active?.columnLabel || "WebLLM";
  const pct = status.pct;
  const indeterminate = Boolean(status.indeterminate);
  const width = pct != null ? Math.max(2, Math.min(100, pct)) : 8;

  return (
    <div
      className="shrink-0 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur-sm md:px-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <p className="min-w-0 truncate text-sm text-fg">
          <span className="font-medium">{stage}</span>
          <span className="text-muted"> · {status.label}</span>
          {active?.ticketKey ? <span className="text-subtle"> · {active.ticketKey}</span> : null}
        </p>
        {pct != null && !indeterminate ? (
          <p className="shrink-0 font-mono text-2xs tabular-nums text-muted">{pct}%</p>
        ) : null}
        {queue.length > 0 ? <p className="shrink-0 text-2xs text-subtle">{queue.length} waiting</p> : null}
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-inset" aria-hidden>
        {indeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${width}%` }} />
        )}
      </div>
    </div>
  );
}
