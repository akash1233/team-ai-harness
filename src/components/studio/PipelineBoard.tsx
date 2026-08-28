import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useBoardStore } from "@/lib/board-store";
import { DISCOVERY_FLOW_ID, BLOCKED_COLUMN_ID } from "@/lib/columns";
import { resolveStep, shortAgent } from "@/lib/agents";
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
  const execution = config.execution;
  const flowId = config.activeFlowId;
  const inFlow = tickets.filter((t) => (t.flowId || DISCOVERY_FLOW_ID) === flowId);

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden bg-bg">
      <div className="flex h-full min-w-max gap-3 px-3 py-3 md:px-5">
        {columns.map((col, i) => {
          const here = inFlow.filter((t) => t.columnId === col.id);
          const step = resolveStep(col, execution);
          const agent = col.agent && col.agent !== "inherit" ? shortAgent(step.kind) : null;
          const failed =
            col.id === BLOCKED_COLUMN_ID
              ? here.length > 0
              : here.some((t) => t.status === "blocked") ||
                inFlow.some((t) => t.agentResponses.some((r) => r.columnId === col.id && r.ok === false));
          const runnable = col.role === "prompt" || col.role === "plan" || col.role === "review" || col.role === "approve";
          const busy = here.some((t) => t.status === "executing");
          const lastRun = inFlow
            .flatMap((t) => t.agentResponses.filter((r) => r.columnId === col.id))
            .sort((a, b) => (a.at < b.at ? 1 : -1))[0];

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
                      {agent ? ` · ${agent}` : col.role === "prompt" || col.role === "plan" ? ` · ${step.label}` : ""}
                      {col.outputKey ? ` · {{${col.outputKey}}}` : ""}
                    </p>
                  </div>
                  <span className={cn("font-mono text-micro tabular-nums", failed ? "text-danger" : "text-subtle")}>
                    {here.length}
                  </span>
                </div>
                {col.promptTemplate ? (
                  <p className="mt-2 text-2xs leading-relaxed text-muted">{col.promptTemplate}</p>
                ) : null}
                {lastRun ? (
                  <p className={cn("mt-2 text-micro", lastRun.ok === false ? "text-danger" : "text-muted")}>
                    Last: {lastRun.ok === false ? "failed" : lastRun.summary}
                    {lastRun.via ? ` · ${lastRun.via}` : ""}
                  </p>
                ) : (
                  <p className="mt-2 text-micro text-subtle">No runs on this step yet.</p>
                )}
                {runnable ? (
                  <Button
                    variant={failed ? "secondary" : "primary"}
                    size="md"
                    className="mt-3 w-full"
                    disabled={busy || here.length === 0}
                    title={
                      here.length === 0
                        ? inFlow.length === 0
                          ? "Create a ticket first (New ticket). Tickets start in stage 01."
                          : "No tickets in this column. Drag one here, or Test this stage in Settings → Pipeline."
                        : `Run ${step.label} on tickets in this stage`
                    }
                    onClick={() => {
                      setActiveStage(col.id);
                      void runColumn(col.id);
                    }}
                  >
                    <Play className="size-3.5 fill-current" />
                    {busy ? "Running…" : `Run ${step.label}`}
                  </Button>
                ) : null}
                {runnable && here.length === 0 ? (
                  <p className="mt-2 text-2xs text-muted">
                    {inFlow.length === 0
                      ? "Create a ticket, then Run. Tickets start in stage 01."
                      : "Empty — drag a ticket here, or use Settings → Pipeline → Test this stage."}
                  </p>
                ) : null}
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                {here.length === 0 ? (
                  <p className="text-2xs text-subtle">Drop a ticket here.</p>
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
  );
}
