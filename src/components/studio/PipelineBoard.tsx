import { Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useBoardStore } from "@/lib/board-store";
import { DISCOVERY_FLOW_ID } from "@/lib/columns";
import { isReviewGate, isRunnableStage, resolveStep, stepBadge } from "@/lib/agents";
import { stagePurpose } from "@/lib/stage-purpose";
import { ExecutionTrail } from "./ExecutionTrail";
import { TicketNote } from "./TicketNote";

export function PipelineBoard() {
  const columns = useBoardStore((s) => s.config.columns);
  const tickets = useBoardStore((s) => s.tickets);
  const config = useBoardStore((s) => s.config);
  const selectedId = useBoardStore((s) => s.selectedId);
  const select = useBoardStore((s) => s.select);
  const setActiveStage = useBoardStore((s) => s.setActiveStage);
  const moveTicket = useBoardStore((s) => s.moveTicket);
  const runColumn = useBoardStore((s) => s.runColumn);
  const approve = useBoardStore((s) => s.approve);
  const execution = config.execution;
  const flowId = config.activeFlowId;
  const inFlow = tickets.filter((t) => (t.flowId || DISCOVERY_FLOW_ID) === flowId);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full min-w-max gap-3 px-3 py-3 md:px-5">
        {columns.map((col, i) => {
          const here = inFlow.filter((t) => t.columnId === col.id);
          const lastRun = inFlow
            .flatMap((t) => t.agentResponses.filter((r) => r.columnId === col.id))
            .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
          const step = resolveStep(col, execution);
          const badge = stepBadge(col, execution);
          const failed =
            here.some((t) => t.status === "blocked") ||
            inFlow.some((t) => t.agentResponses.some((r) => r.columnId === col.id && r.ok === false));
          const reviewGate = isReviewGate(col);
          const runnable = isRunnableStage(col);
          const busy = here.some((t) => t.status === "executing");

          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/ticket-id");
                if (id) moveTicket(id, col.id);
              }}
              className={cn(
                "flex h-full w-[20.5rem] shrink-0 flex-col rounded-lg border",
                failed ? "border-danger/40 bg-danger/5" : "border-border bg-surface",
                !col.enabled && "opacity-60",
              )}
            >
              <header className="shrink-0 border-b border-border px-3 py-3">
                <div className="flex items-start gap-2">
                  <span className={cn("font-mono text-micro tabular-nums", failed ? "text-danger" : "text-subtle")}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-serif text-lg font-medium leading-tight tracking-tight">{col.name}</h2>
                    <p className="text-micro uppercase tracking-widest text-subtle">
                      {col.role.replace("-", " ")}
                      {badge ? ` · ${badge}` : !step.manual && (col.role === "prompt" || col.role === "plan") ? ` · ${step.label}` : ""}
                      {col.outputKey ? ` · {{${col.outputKey}}}` : ""}
                    </p>
                  </div>
                  <span className={cn("font-mono text-micro tabular-nums", failed ? "text-danger" : "text-subtle")}>
                    {here.length}
                  </span>
                </div>
                <p className="mt-2 text-2xs leading-relaxed text-muted">{stagePurpose(col)}</p>
                {busy ? (
                  <p className="mt-2 text-micro text-muted">Running…</p>
                ) : lastRun ? (
                  <p className={cn("mt-2 text-micro", lastRun.ok === false ? "text-danger" : "text-subtle")}>
                    {lastRun.ok === false ? "Last run failed" : "Last run ok"}
                    {lastRun.via ? ` · ${lastRun.via}` : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-micro text-subtle">Not run yet</p>
                )}
                {reviewGate ? (
                  <Button
                    variant={failed ? "secondary" : "primary"}
                    size="md"
                    className="mt-3 w-full"
                    disabled={here.length === 0}
                    title="Approve the previous stage output and move on"
                    onClick={() => {
                      const ticket = here.find((t) => t.id === selectedId) ?? here[0];
                      if (!ticket) return;
                      setActiveStage(col.id);
                      select(ticket.id);
                      approve(ticket.id);
                    }}
                  >
                    <Check className="size-3.5" />
                    Approve
                  </Button>
                ) : runnable ? (
                  <Button
                    variant={failed ? "secondary" : "primary"}
                    size="md"
                    className="mt-3 w-full"
                    disabled={busy}
                    title={step.manual ? "Save human input for this stage" : `Run ${step.label}`}
                    onClick={() => {
                      setActiveStage(col.id);
                      void runColumn(col.id);
                    }}
                  >
                    <Play className="size-3.5 fill-current" />
                    {busy ? "Running…" : here.length === 0 ? `Start · ${step.label}` : step.manual ? "Save & continue" : `Run ${step.label}`}
                  </Button>
                ) : null}
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                {here.length === 0 ? (
                  <p className="text-2xs text-subtle">No tickets on this stage.</p>
                ) : (
                  here.map((ticket) => (
                    <TicketNote
                      key={ticket.id}
                      ticket={ticket}
                      selected={ticket.id === selectedId}
                      onSelect={() => {
                        setActiveStage(col.id);
                        select(ticket.id);
                      }}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
        </div>
      </div>
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border px-4 py-3">
        <ExecutionTrail tickets={inFlow} columns={columns} />
      </div>
    </div>
  );
}
