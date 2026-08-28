import { useEffect, useState } from "react";
import { Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBoardStore } from "@/lib/board-store";
import { formatSpend } from "@/lib/format";
import { columnById } from "@/lib/columns";
import { resolveStep } from "@/lib/agents";
import { WorkPanel } from "@/components/board/WorkPanel";
import { NewTicketDialog } from "@/components/board/NewTicketDialog";
import { StageRail } from "./StageRail";
import { TicketList } from "./TicketList";
import { TeamSettings } from "./TeamSettings";

export function Studio() {
  const hydrate = useBoardStore((s) => s.hydrate);
  const config = useBoardStore((s) => s.config);
  const tickets = useBoardStore((s) => s.tickets);
  const selectedId = useBoardStore((s) => s.selectedId);
  const settingsOpen = useBoardStore((s) => s.settingsOpen);
  const toggleSettings = useBoardStore((s) => s.toggleSettings);
  const reset = useBoardStore((s) => s.reset);
  const activeMemberId = useBoardStore((s) => s.activeMemberId);
  const setActiveMember = useBoardStore((s) => s.setActiveMember);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    document.documentElement.dataset.theme = config.theme;
    document.documentElement.dataset.density = config.density;
  }, [config.theme, config.density]);

  const spend = tickets.reduce((n, t) => n + t.spend, 0);
  const selected = tickets.some((t) => t.id === selectedId);
  const activeStageId = useBoardStore((s) => s.activeStageId);
  const step = resolveStep(columnById(activeStageId, config.columns), config.execution);

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden h-6 w-1 rounded-full bg-accent sm:block" aria-hidden />
          <div className="min-w-0">
            <p className="font-serif text-lg leading-none tracking-tight">{config.name}</p>
            <p className="text-micro uppercase tracking-widest text-subtle">{config.workflowName}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {config.showSpend ? (
            <span className="hidden font-mono text-2xs tabular-nums text-muted sm:inline">
              {formatSpend(spend)}
            </span>
          ) : null}
          <span className="hidden rounded-full border border-border px-2.5 py-1 font-mono text-micro text-muted sm:inline">
            {step.label}
          </span>
          <label className="hidden sm:block">
            <span className="sr-only">Working as</span>
            <select
              className="h-11 rounded-md border border-border bg-surface px-2 text-sm"
              value={activeMemberId}
              onChange={(e) => setActiveMember(e.target.value)}
            >
              {config.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" size="md" onClick={() => reset()} title="Reset sample tickets">
            <RotateCcw className="size-4" />
            <span className="hidden md:inline">Reset</span>
          </Button>
          <Button variant="secondary" size="md" onClick={() => toggleSettings(true)}>
            <SlidersHorizontal className="size-4" />
            Team
          </Button>
          <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" />
            New
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <StageRail />
        <TicketList />
        {selected ? (
          <div className="fixed inset-0 z-30 bg-surface md:static md:z-auto md:h-full md:w-96 md:border-l md:border-border">
            <WorkPanel />
          </div>
        ) : null}
      </div>

      <NewTicketDialog open={newOpen} onOpenChange={setNewOpen} />
      {settingsOpen ? <TeamSettings /> : null}
    </div>
  );
}
