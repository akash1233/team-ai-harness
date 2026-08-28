import { useBoardStore } from "@/lib/board-store";
import type { Ticket, WorkflowColumn } from "@/lib/types";
import { RunLog } from "./RunLog";

export function ExecutionTrail({
  tickets,
  columns,
}: {
  tickets: Ticket[];
  stageId?: string;
  columns: WorkflowColumn[];
}) {
  const flowId = useBoardStore((s) => s.config.activeFlowId);
  const flowRuns = useBoardStore((s) => s.flowRuns).filter((r) => r.flowId === flowId);
  const live = tickets.filter((t) => t.status === "executing" && t.liveLog);
  const vars = tickets.flatMap((t) =>
    Object.entries(t.vars ?? {})
      .filter(([, v]) => v.trim())
      .map(([k, v]) => ({ ticket: t.key, k, v })),
  );
  const history = flowRuns.map((r) => ({
    id: r.id,
    at: r.at,
    columnId: r.columnId,
    summary: `${r.ticketKey} · ${r.summary}${r.variable ? ` · {{${r.variable}}}` : ""}`,
    body: r.output,
    via: r.via,
    ok: r.ok,
    error: r.error,
  }));
  const fallback = tickets.flatMap((t) => t.agentResponses);
  const responses = history.length ? history : fallback;

  return (
    <section className="mt-6 flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-lg font-medium tracking-tight">This pipeline</h2>
        <p className="mb-2 text-2xs text-muted">
          Every run on the active flow stays here until you switch flows or reset. Current variables, then the full history.
        </p>
        {vars.length === 0 ? (
          <p className="text-sm text-muted">No variables yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {vars.map((row) => (
              <li key={`${row.ticket}-${row.k}`} className="rounded-md border border-border bg-inset px-3 py-2">
                <p className="font-mono text-2xs text-subtle">
                  {row.ticket} · {`{{${row.k}}}`}
                </p>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-sm text-fg">{row.v}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
      {live.length > 0 ? (
        <div>
          <h2 className="font-serif text-lg font-medium tracking-tight">Live log</h2>
          {live.map((t) => (
            <pre
              key={t.id}
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-inset p-3 font-mono text-2xs text-muted"
            >
              {t.liveLog}
            </pre>
          ))}
        </div>
      ) : null}
      <div>
        <h2 className="font-serif text-lg font-medium tracking-tight">Run history</h2>
        <p className="mb-2 text-2xs text-muted">{responses.length} run{responses.length === 1 ? "" : "s"} on this flow.</p>
        <RunLog responses={responses} columns={columns} />
      </div>
    </section>
  );
}