import { cn } from "@/lib/cn";
import { useBoardStore } from "@/lib/board-store";
import { formatSpend, channelLabel } from "@/lib/format";
import { columnById } from "@/lib/columns";
import { outputVarName } from "@/lib/flow-context";
import type { Ticket } from "@/lib/types";

export function TicketNote({ ticket, selected, onSelect }: { ticket: Ticket; selected: boolean; onSelect: () => void }) {
  const config = useBoardStore((s) => s.config);
  const owner = config.members.find((m) => m.id === ticket.ownerId);
  const col = columnById(ticket.columnId, config.columns);
  const last = ticket.agentResponses.find((r) => r.columnId === ticket.columnId) ?? ticket.agentResponses[0];
  const failed = ticket.status === "blocked";
  const output = ticket.outputs[ticket.columnId] || last?.body || "";
  const error = ticket.blockedReason || (last?.ok === false ? last.error || last.body : "");
  const writes = outputVarName(col);
  const vars = Object.entries(ticket.vars ?? {}).filter(([, v]) => v.trim());

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/ticket-id", ticket.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onSelect}
      className={cn(
        "ticket-note cursor-pointer rounded-sm border bg-elevated text-left",
        failed ? "border-danger" : selected ? "border-accent" : "border-border",
      )}
    >
      <span className="ticket-note-tape" aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-micro text-subtle">{ticket.key}</p>
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
        ) : (
          <span className="text-micro uppercase tracking-wide text-subtle">{col?.label ?? ticket.columnId}</span>
        )}
      </div>
      <h3 className="mt-2 font-serif text-base font-medium leading-snug tracking-tight">{ticket.title}</h3>
      {ticket.description ? (
        <p className="mt-2 text-2xs leading-relaxed text-muted">{ticket.description}</p>
      ) : null}

      {failed && error ? (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-danger/40 bg-danger/5 p-2 font-mono text-micro text-danger">
          {error}
        </pre>
      ) : output ? (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-inset p-2 font-mono text-micro text-muted">
          {output}
        </pre>
      ) : (
        <p className="mt-3 text-micro text-subtle">No agent output yet.</p>
      )}

      {last ? (
        <p className="mt-2 text-micro text-muted">
          Last run {last.at.replace("T", " ").slice(0, 16)}
          {last.via ? ` · ${last.via}` : ""}
          {last.summary ? ` · ${last.summary}` : ""}
        </p>
      ) : null}

      {writes ? (
        <p className="mt-1 font-mono text-micro text-subtle">
          writes {`{{${writes}}}`}
        </p>
      ) : null}

      {vars.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {vars.map(([k, v]) => (
            <li key={k} className="text-micro">
              <span className="font-mono text-fg">{k}</span>
              <span className="ml-1 text-muted">{v.length > 160 ? `${v.slice(0, 160)}…` : v}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {ticket.slackChannel ? (
        <p className="mt-2 text-micro text-muted">Slack {channelLabel(ticket.slackChannel)}</p>
      ) : null}
      {ticket.slackMembers ? <p className="text-micro text-muted">Notify {ticket.slackMembers}</p> : null}

      {ticket.plan ? (
        <p className="mt-2 text-micro text-muted">
          Plan · {ticket.plan.steps.length} issues · {ticket.plan.summary}
        </p>
      ) : null}
      {ticket.jiraCreated.length > 0 ? (
        <ul className="mt-1 font-mono text-micro text-fg">
          {ticket.jiraCreated.map((j) => (
            <li key={j.key}>
              {j.key} {j.title}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-micro text-subtle">
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
