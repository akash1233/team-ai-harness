import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useBoardStore } from "@/lib/board-store";
import { columnById, DISCOVERY_FLOW_ID } from "@/lib/columns";
import { formatSpend } from "@/lib/format";
import { resolveStep } from "@/lib/agents";

export function TicketList() {
  const tickets = useBoardStore((s) => s.tickets);
  const config = useBoardStore((s) => s.config);
  const activeStageId = useBoardStore((s) => s.activeStageId);
  const selectedId = useBoardStore((s) => s.selectedId);
  const select = useBoardStore((s) => s.select);
  const runColumn = useBoardStore((s) => s.runColumn);
  const col = columnById(activeStageId, config.columns);
  const inStage = tickets.filter(
    (t) => t.columnId === activeStageId && (t.flowId || DISCOVERY_FLOW_ID) === config.activeFlowId,
  );
  const runnable =
    col &&
    (col.role === "prompt" || col.role === "plan" || col.role === "review" || col.role === "approve");
  const busy = inStage.some((t) => t.status === "executing");
  const step = col ? resolveStep(col, config.execution) : null;
  const demo = config.execution?.demoFallbacks;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-8">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-widest text-subtle">
            {col?.role.replace("-", " ") ?? "stage"}
            {step && (col?.role === "prompt" || col?.role === "plan") ? ` · ${step.label}` : ""}
            {!col?.enabled ? " · off" : ""}
            {demo ? " · demo fallback on" : ""}
          </p>
          <h1 className="font-serif text-3xl font-medium tracking-tight md:text-4xl">{col?.name ?? "Stage"}</h1>
          {col?.promptTemplate ? (
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted line-clamp-2">{col.promptTemplate}</p>
          ) : (
            <p className="mt-2 max-w-xl text-sm text-muted">
              {inStage.length} in this stage. Drag onto another stage in the rail to move.
            </p>
          )}
        </div>
        {runnable ? (
          <Button
            variant="primary"
            size="md"
            disabled={busy || inStage.length === 0}
            onClick={() => runColumn(activeStageId)}
          >
            <Play className="size-4 fill-current" />
            Run {step?.label ?? "agent"}
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8">
        {inStage.length === 0 ? (
          <div className="flex h-full min-h-48 items-end rounded-lg border border-dashed border-border px-6 py-8">
            <p className="max-w-sm text-sm text-muted">
              Nothing in {col?.label ?? "this stage"}. Open another stage, or drop a ticket on the rail.
            </p>
          </div>
        ) : (
          <ul className="flex max-w-2xl flex-col gap-3">
            {inStage.map((ticket) => {
              const owner = config.members.find((m) => m.id === ticket.ownerId);
              const selected = ticket.id === selectedId;
              return (
                <li key={ticket.id}>
                  <article
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/ticket-id", ticket.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => select(ticket.id)}
                    className={cn(
                      "ticket-doc cursor-pointer rounded-lg border bg-elevated p-5 text-left shadow-panel transition-opacity",
                      selected ? "border-accent" : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-mono text-2xs text-subtle">{ticket.key}</p>
                      {ticket.status === "executing" ? (
                        <span className="rounded-full bg-exec px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-exec-fg">
                          Running
                        </span>
                      ) : ticket.status === "blocked" ? (
                        <span className="rounded-full bg-danger/15 px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-danger">
                          Blocked
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-2 font-serif text-xl font-medium leading-snug tracking-tight">
                      {ticket.title}
                    </h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{ticket.description}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-2xs text-subtle">
                      {ticket.labels.map((l) => (
                        <span key={l} className="rounded-full bg-inset px-2 py-0.5 text-muted">
                          {l}
                        </span>
                      ))}
                      {owner ? <span>{owner.name}</span> : null}
                      {config.showSpend ? (
                        <span className="ml-auto font-mono tabular-nums">{formatSpend(ticket.spend)}</span>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
