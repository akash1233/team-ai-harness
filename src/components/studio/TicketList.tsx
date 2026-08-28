import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useBoardStore } from "@/lib/board-store";
import { columnById, DISCOVERY_FLOW_ID } from "@/lib/columns";
import { formatSpend } from "@/lib/format";
import { resolveStep } from "@/lib/agents";
import { RunLog } from "./RunLog";
import type { Ticket } from "@/lib/types";

export function TicketList() {
  const tickets = useBoardStore((s) => s.tickets);
  const config = useBoardStore((s) => s.config);
  const activeStageId = useBoardStore((s) => s.activeStageId);
  const selectedId = useBoardStore((s) => s.selectedId);
  const select = useBoardStore((s) => s.select);
  const runColumn = useBoardStore((s) => s.runColumn);
  const col = columnById(activeStageId, config.columns);
  const inFlow = tickets.filter((t) => (t.flowId || DISCOVERY_FLOW_ID) === config.activeFlowId);
  const inStage = inFlow.filter((t) => t.columnId === activeStageId);
  const runnable =
    col &&
    (col.role === "prompt" || col.role === "plan" || col.role === "review" || col.role === "approve");
  const busy = inStage.some((t) => t.status === "executing");
  const step = col ? resolveStep(col, config.execution) : null;
  const stageLog = inFlow
    .flatMap((t) => t.agentResponses.filter((r) => r.columnId === activeStageId).map((r) => ({ t, r })))
    .sort((a, b) => (a.r.at < b.r.at ? 1 : -1))
    .slice(0, 12);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 md:px-8">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-widest text-subtle">
            {col ? `${String(config.columns.findIndex((c) => c.id === col.id) + 1).padStart(2, "0")} · ${col.role.replace("-", " ")}` : "Pick a stage"}
            {step && col && (col.role === "prompt" || col.role === "plan") ? ` · ${step.label}` : ""}
          </p>
          <h1 className="font-serif text-3xl font-medium tracking-tight md:text-4xl">{col?.label || col?.name || "Stage"}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {inStage.length} in this stage. Run from here — Terminal opens and the last agent reply is the output.
          </p>
        </div>
        {runnable ? (
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            onClick={() => void runColumn(activeStageId)}
          >
            <Play className="size-4 fill-current" />
            {busy ? "Running…" : inStage.length === 0 ? `Start · ${step?.label ?? "agent"}` : `Run ${step?.label ?? "agent"}`}
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8">
        {inStage.length === 0 ? (
          <div className="flex min-h-32 items-end rounded-lg border border-dashed border-border px-6 py-8">
            <p className="max-w-sm text-sm text-muted">
              Nothing in this stage yet. <strong className="font-medium text-fg">Start</strong> runs Cursor/Claude with this stage’s prompt and creates a ticket.
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

        <section className="mt-8 max-w-2xl">
          <h2 className="font-serif text-lg font-medium tracking-tight">What happened</h2>
          <p className="mb-3 text-2xs text-muted">
            Full agent output for this step, including failures. Open a ticket for the complete run history.
          </p>
          <RunLog responses={stageLog.map((x) => x.r)} columns={config.columns} compact />
        </section>
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
  const last = ticket.agentResponses.find((r) => r.columnId === stageId);
  const output = ticket.outputs[stageId] || last?.body || "";
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
        "ticket-doc cursor-pointer rounded-lg border bg-elevated p-5 text-left shadow-panel transition-opacity",
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
      <h2 className="mt-2 font-serif text-xl font-medium leading-snug tracking-tight">{ticket.title}</h2>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{ticket.description}</p>
      {failed && error ? (
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/5 p-2 font-mono text-2xs text-danger">
          {error}
        </pre>
      ) : output ? (
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-inset p-2 font-mono text-2xs text-muted">
          {output}
        </pre>
      ) : (
        <p className="mt-3 text-2xs text-subtle">No output yet for this step.</p>
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
