import { useBoardStore } from "@/lib/board-store";
import type { AgentResponse, Ticket, WorkflowColumn } from "@/lib/types";
import { RunLog } from "./RunLog";

export function ExecutionTrail({
  tickets,
  columns,
}: {
  tickets: Ticket[];
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

  const seen = new Set<string>();
  const responses: AgentResponse[] = [];
  for (const r of flowRuns) {
    const key = `${r.ticketId}|${r.columnId}|${r.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    responses.push({
      id: r.id,
      at: r.at,
      columnId: r.columnId,
      summary: `${r.ticketKey} · ${r.summary}${r.variable ? ` · {{${r.variable}}}` : ""}`,
      input: r.input,
      body: r.output,
      via: r.via,
      ok: r.ok,
      error: r.error,
    });
  }
  for (const t of tickets) {
    for (const r of t.agentResponses) {
      const key = `${t.id}|${r.columnId}|${r.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      responses.push({ ...r, summary: `${t.key} · ${r.summary}` });
    }
  }
  responses.sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-lg font-medium tracking-tight">This pipeline</h2>
        <p className="mb-2 text-2xs text-muted">
          Full history for the active flow. Switching stages does not clear it.
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