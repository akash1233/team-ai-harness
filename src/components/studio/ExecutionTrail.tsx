import { outputVarName } from "@/lib/flow-context";
import type { Ticket, WorkflowColumn } from "@/lib/types";
import { RunLog } from "./RunLog";

export function ExecutionTrail({
  tickets,
  stageId,
  columns,
}: {
  tickets: Ticket[];
  stageId?: string;
  columns: WorkflowColumn[];
}) {
  const col = stageId ? columns.find((c) => c.id === stageId) : undefined;
  const writes = outputVarName(col);
  const responses = tickets
    .flatMap((t) =>
      t.agentResponses
        .filter((r) => !stageId || r.columnId === stageId)
        .map((r) => ({ ...r, ticketKey: t.key })),
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const live = tickets.filter((t) => t.status === "executing" && t.liveLog);
  const vars = tickets.flatMap((t) =>
    Object.entries(t.vars ?? {})
      .filter(([, v]) => v.trim())
      .map(([k, v]) => ({ ticket: t.key, k, v })),
  );

  return (
    <section className="mt-6 flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-lg font-medium tracking-tight">Output variables</h2>
        <p className="mb-2 text-2xs text-muted">
          {writes ? (
            <>
              This stage writes <span className="font-mono text-fg">{`{{${writes}}}`}</span>. Later prompts read it as-is.
            </>
          ) : (
            "Named outputs from this run."
          )}
        </p>
        {vars.length === 0 ? (
          <p className="text-sm text-muted">No variables yet. Run the stage to fill them.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {vars.map((row) => (
              <li key={`${row.ticket}-${row.k}`} className="rounded-md border border-border bg-inset px-3 py-2">
                <p className="font-mono text-2xs text-subtle">
                  {row.ticket} · {`{{${row.k}}}`}
                </p>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-sm text-fg">{row.v}</pre>
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
        <h2 className="font-serif text-lg font-medium tracking-tight">What ran</h2>
        <p className="mb-2 text-2xs text-muted">Full agent output for this stage, including failures.</p>
        <RunLog responses={responses} columns={columns} />
      </div>
    </section>
  );
}