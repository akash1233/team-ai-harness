import { Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useBoardStore } from "@/lib/board-store";
import { columnById, DISCOVERY_FLOW_ID } from "@/lib/columns";
import { formatSpend } from "@/lib/format";
import { isReviewGate, isRunnableStage, resolveStep } from "@/lib/agents";
import { outputVarName, reviewSourceText } from "@/lib/flow-context";
import { stagePurpose } from "@/lib/stage-purpose";
import { ExecutionTrail } from "./ExecutionTrail";
import type { Ticket } from "@/lib/types";

export function TicketList() {
  const tickets = useBoardStore((s) => s.tickets);
  const config = useBoardStore((s) => s.config);
  const activeStageId = useBoardStore((s) => s.activeStageId);
  const selectedId = useBoardStore((s) => s.selectedId);
  const select = useBoardStore((s) => s.select);
  const runColumn = useBoardStore((s) => s.runColumn);
  const approve = useBoardStore((s) => s.approve);
  const col = columnById(activeStageId, config.columns);
  const inFlow = tickets.filter((t) => (t.flowId || DISCOVERY_FLOW_ID) === config.activeFlowId);
  const waiting = inFlow.filter((t) => t.columnId === activeStageId);
  const inStage = inFlow.filter(
    (t) =>
      t.columnId === activeStageId ||
      Boolean(t.outputs[activeStageId]) ||
      t.agentResponses.some((r) => r.columnId === activeStageId),
  );
  const reviewGate = isReviewGate(col);
  const runnable = isRunnableStage(col);
  const busy = inFlow.some((t) => t.status === "executing");
  const step = col ? resolveStep(col, config.execution) : null;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-8">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-widest text-subtle">
            {col
              ? `${String(config.columns.findIndex((c) => c.id === col.id) + 1).padStart(2, "0")} · ${col.role.replace("-", " ")}`
              : "Pick a stage"}
            {step && col && isRunnableStage(col) ? ` · ${step.label}` : ""}
            {col?.outputKey ? ` · {{${col.outputKey}}}` : ""}
          </p>
          <h1 className="font-serif text-3xl font-medium tracking-tight md:text-4xl">{col?.label || col?.name || "Stage"}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {col ? stagePurpose(col) : "Pick a stage from the rail."}
          </p>
        </div>
        {reviewGate ? (
          <Button
            variant="primary"
            size="md"
            disabled={waiting.length === 0}
            onClick={() => {
              const ticket = waiting.find((t) => t.id === selectedId) ?? waiting[0];
              if (!ticket) return;
              select(ticket.id);
              approve(ticket.id);
            }}
          >
            <Check className="size-4" />
            Approve
          </Button>
        ) : runnable ? (
          <Button variant="primary" size="md" disabled={busy} onClick={() => void runColumn(activeStageId)}>
            <Play className="size-4 fill-current" />
            {busy ? "Running…" : inStage.length === 0 ? `Start · ${step?.label ?? "stage"}` : step?.manual ? "Save & continue" : `Run ${step?.label ?? "stage"}`}
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8">
        {inStage.length === 0 ? (
          <div className="flex min-h-20 items-end rounded-lg border border-dashed border-border px-6 py-6">
            <p className="max-w-sm text-sm text-muted">
              Nothing waiting in this stage. Earlier runs stay in history below.
            </p>
          </div>
        ) : (
          <ul className="flex max-w-2xl flex-col gap-3">
            {inStage.map((ticket) => (
              <li key={ticket.id}>
                <TicketCard
                  ticket={ticket}
                  selected={ticket.id === selectedId}
                  stageId={activeStageId}
                  onSelect={() => select(ticket.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border px-4 py-3 md:px-8">
        <div className="max-w-2xl">
          <ExecutionTrail tickets={inFlow} columns={config.columns} />
        </div>
      </div>
    </section>
  );
}

function TicketCard({
  ticket,
  selected,
  stageId,
  onSelect,
}: {
  ticket: Ticket;
  selected: boolean;
  stageId: string;
  onSelect: () => void;
}) {
  const config = useBoardStore((s) => s.config);
  const owner = config.members.find((m) => m.id === ticket.ownerId);
  const failed = ticket.status === "blocked";
  const last = ticket.agentResponses.find((r) => r.columnId === stageId) ?? ticket.agentResponses[0];
  const stageCol = config.columns.find((c) => c.id === stageId);
  const writes = outputVarName(stageCol);
  const output =
    ticket.status === "executing"
      ? ticket.liveLog || ""
      : isReviewGate(stageCol)
        ? reviewSourceText(ticket, stageCol, config.columns)
        : (writes && ticket.vars?.[writes]) ||
          ticket.outputs[stageId] ||
          last?.body ||
          "";
  const error = ticket.blockedReason || (last?.ok === false ? last.error || last.body : "");

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/ticket-id", ticket.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onSelect}
      className={cn(
        "ticket-doc cursor-pointer rounded-lg border bg-elevated p-5 text-left shadow-panel",
        failed ? "border-danger" : selected ? "border-accent" : "border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-2xs text-subtle">{ticket.key}</p>
        {ticket.status === "executing" ? (
          <span className="rounded-full bg-exec px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-exec-fg">
            Running
          </span>
        ) : failed ? (
          <span className="rounded-full bg-danger px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-danger-fg">
            Failed
          </span>
        ) : last ? (
          <span className="rounded-full bg-inset px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-muted">
            {last.via || "done"}
          </span>
        ) : null}
      </div>
      <h2 className="mt-2 font-serif text-xl font-medium leading-snug tracking-tight">
        {stageCol?.label || stageCol?.name || "Stage"}
      </h2>
      {stageCol ? <p className="mt-1 text-sm text-muted">{stagePurpose(stageCol)}</p> : null}
      {failed && error ? (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/5 p-2 font-mono text-2xs text-danger">
          {error}
        </pre>
      ) : output ? (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-inset p-3 text-sm text-fg">
          {output}
        </pre>
      ) : (
        <p className="mt-3 text-2xs text-subtle">No output yet</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-2xs text-subtle">
        {ticket.labels.map((l) => (
          <span key={l} className="rounded-full bg-inset px-2 py-0.5 text-muted">
            {l}
          </span>
        ))}
        {owner ? <span>{owner.name}</span> : null}
        {config.showSpend ? <span className="ml-auto font-mono tabular-nums">{formatSpend(ticket.spend)}</span> : null}
      </div>
    </article>
  );
}