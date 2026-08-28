import { cn } from "@/lib/cn";
import { useBoardStore } from "@/lib/board-store";
import { DISCOVERY_FLOW_ID } from "@/lib/columns";
import { resolveStep, shortAgent } from "@/lib/agents";

export function StageRail() {
  const columns = useBoardStore((s) => s.config.columns);
  const tickets = useBoardStore((s) => s.tickets);
  const activeStageId = useBoardStore((s) => s.activeStageId);
  const setActiveStage = useBoardStore((s) => s.setActiveStage);
  const moveTicket = useBoardStore((s) => s.moveTicket);
  const execution = useBoardStore((s) => s.config.execution);
  const flowId = useBoardStore((s) => s.config.activeFlowId);
  const inFlow = tickets.filter((t) => (t.flowId || DISCOVERY_FLOW_ID) === flowId);

  return (
    <nav
      aria-label="Pipeline"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-2 md:h-full md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:px-3 md:py-4"
    >
      {columns.map((col, i) => {
        const count = inFlow.filter((t) => t.columnId === col.id).length;
        const active = col.id === activeStageId;
        const agent =
          col.agent && col.agent !== "inherit" ? shortAgent(resolveStep(col, execution).kind) : null;
        return (
          <button
            key={col.id}
            type="button"
            onClick={() => setActiveStage(col.id)}
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
              "flex min-h-11 min-w-36 items-center gap-2 rounded-md px-3 text-left md:min-w-0 md:w-full",
              active ? "bg-accent text-accent-fg" : "text-muted hover:bg-inset hover:text-fg",
              !col.enabled && "opacity-50",
            )}
          >
            <span className={cn("font-mono text-micro tabular-nums", active ? "text-accent-fg/70" : "text-subtle")}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{col.label}</span>
            {agent ? (
              <span className={cn("hidden font-mono text-micro md:inline", active ? "text-accent-fg/80" : "text-subtle")}>
                {agent}
              </span>
            ) : null}
            <span
              className={cn(
                "font-mono text-micro tabular-nums",
                active ? "text-accent-fg/80" : "text-subtle",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}