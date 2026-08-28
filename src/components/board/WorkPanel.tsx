import { useState } from "react";
import { Check, Play, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { columnById } from "@/lib/columns";
import { mentionedKeys, outputVarName } from "@/lib/flow-context";
import { channelLabel, formatSpend } from "@/lib/format";
import { resolveStep } from "@/lib/agents";
import { formatGrillRecord } from "@/lib/grill";
import { GrillRoom } from "@/components/studio/GrillRoom";
import { RunLog } from "@/components/studio/RunLog";
import type { Ticket } from "@/lib/types";

export function WorkPanel() {
  const selectedId = useBoardStore((s) => s.selectedId);
  const tickets = useBoardStore((s) => s.tickets);
  const config = useBoardStore((s) => s.config);
  const select = useBoardStore((s) => s.select);
  const ticket = tickets.find((t) => t.id === selectedId) ?? null;
  if (!ticket) return null;
  const col = columnById(ticket.columnId, config.columns);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col bg-surface">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-micro text-subtle">{ticket.key}</p>
          <h2 className="font-serif text-lg font-medium leading-snug tracking-tight">{ticket.title}</h2>
          <p className="mt-1 text-micro uppercase tracking-wider text-muted">
            {col?.name ?? ticket.columnId}
            {config.showSpend ? (
              <>
                {" · "}
                <span className="font-mono tabular-nums normal-case tracking-normal">{formatSpend(ticket.spend)}</span>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-md text-subtle hover:bg-inset hover:text-fg"
          aria-label="Close panel"
          onClick={() => select(null)}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-4 text-sm leading-relaxed text-muted">{ticket.description}</p>
        {ticket.status === "blocked" && ticket.blockedReason ? (
          <pre className="mb-4 overflow-auto whitespace-pre-wrap rounded-md border border-danger/50 bg-danger/5 p-3 font-mono text-2xs text-danger">
            {ticket.blockedReason}
          </pre>
        ) : null}
        <FlowVars ticket={ticket} />
        <StepBody ticket={ticket} />
        <section className="mt-6">
          <h3 className="mb-2 font-serif text-base font-medium">Agent log</h3>
          <RunLog responses={ticket.agentResponses} columns={config.columns} />
        </section>
      </div>
    </aside>
  );
}

function FlowVars({ ticket }: { ticket: Ticket }) {
  const columns = useBoardStore((s) => s.config.columns);
  const col = columnById(ticket.columnId, columns);
  const writes = outputVarName(col);
  const uses = mentionedKeys(col?.promptTemplate).filter((k) => !k.startsWith("ticket."));
  const filled = Object.entries(ticket.vars ?? {}).filter(([, v]) => v.trim());
  if (!writes && uses.length === 0 && filled.length === 0) return null;
  return (
    <section className="mb-4 rounded-md border border-border bg-inset px-3 py-2">
      <p className="text-micro uppercase tracking-widest text-subtle">Flow variables</p>
      {uses.length > 0 ? (
        <p className="mt-1 text-2xs text-muted">
          This stage reads {uses.map((k) => `{{${k}}}`).join(" ")}
        </p>
      ) : null}
      {writes ? (
        <p className="mt-1 text-2xs text-muted">
          Writes <span className="font-mono text-fg">{`{{${writes}}}`}</span> for later stages
        </p>
      ) : null}
      {filled.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {filled.map(([k, v]) => (
            <li key={k} className="text-2xs">
              <span className="font-mono text-fg">{k}</span>
              <span className="ml-2 text-muted line-clamp-2">{v}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function StepBody({ ticket }: { ticket: Ticket }) {
  const columns = useBoardStore((s) => s.config.columns);
  const col = columnById(ticket.columnId, columns);
  if (!col) return null;
  if (col.role === "collect-input" && col.id === "ideation") return <IdeationForm ticket={ticket} />;
  if (col.role === "collect-input" && col.id === "transcript") return <TranscriptForm ticket={ticket} />;
  if (col.role === "review" || col.role === "approve") return <ReviewForm ticket={ticket} />;
  if (col.id === "fry") return <GrillRoom ticket={ticket} />;
  if (col.id === "write-plan") return <PlanForm ticket={ticket} />;
  if (col.id === "send-slack") return <SlackForm ticket={ticket} />;
  if (col.id === "file-jira") return <JiraForm ticket={ticket} />;
  if (col.role === "prompt" || col.role === "plan") return <RunForm ticket={ticket} />;
  if (col.id === "done") {
    return <DoneForm ticket={ticket} />;
  }
  if (col.id === "blocked") {
    return (
      <div className="rounded-md border border-danger/40 bg-inset p-3 text-sm text-danger">
        {ticket.blockedReason || "Blocked"}
      </div>
    );
  }
  return <RunForm ticket={ticket} />;
}

function DoneForm({ ticket }: { ticket: Ticket }) {
  const config = useBoardStore((s) => s.config);
  const handoffTicket = useBoardStore((s) => s.handoffTicket);
  const flow = config.flows.find((f) => f.id === (ticket.flowId || config.activeFlowId));
  const nextId = flow?.continueInFlowId;
  const next = config.flows.find((f) => f.id === nextId);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-inset p-3 text-sm text-muted">
        Filed {ticket.jiraCreated.length} issues. Pipeline complete.
        {ticket.jiraCreated.length > 0 ? (
          <ul className="mt-2 space-y-1 font-mono text-fg">
            {ticket.jiraCreated.map((j) => (
              <li key={j.key}>
                {j.key} · {j.title}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {next ? (
        <Button variant="primary" size="md" className="w-full" onClick={() => void handoffTicket(ticket.id, next.id)}>
          Continue in {next.name}
        </Button>
      ) : null}
    </div>
  );
}

function IdeationForm({ ticket }: { ticket: Ticket }) {
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const runTicket = useBoardStore((s) => s.runTicket);
  const config = useBoardStore((s) => s.config);
  const [channel, setChannel] = useState(ticket.slackChannel || config.defaultSlackChannel);
  const [channelId, setChannelId] = useState(ticket.slackChannelId || config.defaultSlackChannelId);
  const [members, setMembers] = useState(ticket.slackMembers);
  const [notes, setNotes] = useState(ticket.ideationNotes);
  const ready = channel.trim() || members.trim();

  function toggleHandle(handle: string) {
    const parts = members.split(/\s+/).filter(Boolean);
    const next = parts.includes(handle) ? parts.filter((p) => p !== handle) : [...parts, handle];
    setMembers(next.join(" "));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Who to notify before Agenda runs. Channel, people from the roster, or both.</p>
      <label className="block">
        <span className="mb-1 block text-2xs text-muted">Slack channel</span>
        <Input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder={config.defaultSlackChannel || "team-channel"}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-2xs text-muted">Channel ID</span>
        <Input
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          placeholder={config.defaultSlackChannelId || "C0…"}
          className="font-mono"
        />
      </label>
      <div>
        <span className="mb-1 block text-2xs text-muted">Notify</span>
        <div className="flex flex-wrap gap-1.5">
          {config.members.map((m) => {
            const on = members.split(/\s+/).includes(m.handle);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleHandle(m.handle)}
                className={`h-9 rounded-full px-3 text-2xs ${on ? "bg-accent text-accent-fg" : "bg-inset text-muted"}`}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-2xs text-muted">Notes</span>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional context" />
      </label>
      <Button
        variant="primary"
        size="md"
        className="w-full"
        disabled={!ready}
        onClick={() => {
          updateTicket(ticket.id, {
            slackChannel: channel.replace(/^#+/, ""),
            slackChannelId: channelId.trim(),
            slackMembers: members,
            ideationNotes: notes,
          });
          void runTicket(ticket.id);
        }}
      >
        Save & advance
      </Button>
    </div>
  );
}

function TranscriptForm({ ticket }: { ticket: Ticket }) {
  const updateTicket = useBoardStore((s) => s.updateTicket);
  const runTicket = useBoardStore((s) => s.runTicket);
  const [text, setText] = useState(ticket.transcript);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Paste the meeting transcript or notes.</p>
      <Textarea
        className="min-h-48"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Maya: The problem is…"
      />
      <Button
        variant="primary"
        size="md"
        className="w-full"
        disabled={!text.trim()}
        onClick={() => {
          updateTicket(ticket.id, { transcript: text });
          void runTicket(ticket.id);
        }}
      >
        Save & advance
      </Button>
    </div>
  );
}

function ReviewForm({ ticket }: { ticket: Ticket }) {
  const approve = useBoardStore((s) => s.approve);
  const columns = useBoardStore((s) => s.config.columns);
  const col = columnById(ticket.columnId, columns);
  const sourceId =
    col?.id === "preview-agenda"
      ? "prep-agenda"
      : col?.id === "preview-synthesize"
        ? "synthesize"
        : col?.id === "preview-fry"
          ? "fry"
          : col?.id === "approve"
            ? "write-plan"
            : ticket.columnId;
  const body =
    col?.id === "preview-fry"
      ? formatGrillRecord(ticket) || ticket.outputs.fry || ""
      : ticket.outputs[sourceId] || ticket.outputs[ticket.columnId] || "";

  return (
    <div className="flex flex-col gap-3">
      {col?.id === "approve" && ticket.plan ? (
        <PlanPreview ticket={ticket} />
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-inset p-3 font-sans text-sm leading-relaxed text-fg">
          {body || "Nothing to preview yet."}
        </pre>
      )}
      <Button
        variant="primary"
        size="md"
        className="w-full"
        onClick={() => {
          approve(ticket.id);
          toast.success("Moved to the next stage");
        }}
      >
        <Check className="size-3.5" />
        Approve
      </Button>
    </div>
  );
}

function RunForm({ ticket }: { ticket: Ticket }) {
  const runTicket = useBoardStore((s) => s.runTicket);
  const advance = useBoardStore((s) => s.advance);
  const config = useBoardStore((s) => s.config);
  const col = columnById(ticket.columnId, config.columns);
  const busy = ticket.status === "executing";
  const hasOutput = Boolean(ticket.outputs[ticket.columnId]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{col?.promptTemplate}</p>
      {hasOutput ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-inset p-3 font-sans text-sm leading-relaxed">
          {ticket.outputs[ticket.columnId]}
        </pre>
      ) : null}
      <Button variant="primary" size="md" className="w-full" disabled={busy} onClick={() => void runTicket(ticket.id)}>
        {busy ? <RotateCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
        {busy ? "Running…" : `Run ${resolveStep(col, config.execution).label}`}
      </Button>
      {!config.autoAdvance && hasOutput ? (
        <Button variant="secondary" size="md" className="w-full" onClick={() => advance(ticket.id)}>
          Advance
        </Button>
      ) : null}
    </div>
  );
}

function SlackForm({ ticket }: { ticket: Ticket }) {
  const runTicket = useBoardStore((s) => s.runTicket);
  const busy = ticket.status === "executing";
  const channel = channelLabel(ticket.slackChannel);
  const agenda = ticket.outputs["prep-agenda"] || "";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Posts the approved agenda verbatim to {channel || "(no channel — will block)"}. Simulated Slack.
      </p>
      <div className="rounded-md border border-border bg-inset p-2 font-mono text-micro text-muted">
        channel {channel || "—"}
        {ticket.slackChannelId ? ` · ${ticket.slackChannelId}` : ""}
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-inset p-3 font-sans text-sm leading-relaxed">
        {agenda || "No approved agenda on this ticket."}
      </pre>
      <Button
        variant="primary"
        size="md"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          await runTicket(ticket.id);
          toast.success(channel ? `Posted to ${channel}` : "Blocked — no channel");
        }}
      >
        {busy ? <RotateCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
        Send agenda
      </Button>
    </div>
  );
}

function JiraForm({ ticket }: { ticket: Ticket }) {
  const runTicket = useBoardStore((s) => s.runTicket);
  const busy = ticket.status === "executing";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Creates issues from the approved plan only. Simulated Jira.</p>
      {ticket.plan ? <PlanPreview ticket={ticket} /> : <p className="text-sm text-danger">No approved plan.</p>}
      <Button
        variant="primary"
        size="md"
        className="w-full"
        disabled={busy || !ticket.plan}
        onClick={async () => {
          await runTicket(ticket.id);
          toast.success("Filed Jira issues");
        }}
      >
        {busy ? <RotateCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
        File in Jira
      </Button>
    </div>
  );
}

function PlanForm({ ticket }: { ticket: Ticket }) {
  const runTicket = useBoardStore((s) => s.runTicket);
  const busy = ticket.status === "executing";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Epics and stories only. Grill Me answers from the spec are binding input.</p>
      {ticket.plan ? <PlanPreview ticket={ticket} /> : null}
      <Button variant="primary" size="md" className="w-full" disabled={busy} onClick={() => void runTicket(ticket.id)}>
        {busy ? <RotateCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
        {busy ? "Writing plan…" : "Write plan"}
      </Button>
    </div>
  );
}

function PlanPreview({ ticket }: { ticket: Ticket }) {
  const plan = ticket.plan;
  if (!plan) return null;
  return (
    <div className="space-y-2 rounded-md border border-border bg-inset p-3">
      <p className="text-sm leading-relaxed text-fg">{plan.summary}</p>
      <ul className="space-y-1">
        {plan.steps.map((s) => (
          <li key={s.title} className="border-t border-border/80 pt-1 text-sm">
            <p className="font-medium text-fg">{s.title}</p>
            <p className="text-muted">{s.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
