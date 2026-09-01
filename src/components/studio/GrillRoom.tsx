import { useMemo, useState } from "react";
import { Mic, Play, RotateCw, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useBoardStore } from "@/lib/board-store";
import { answeredCount } from "@/lib/grill";
import { resolveStep } from "@/lib/agents";
import { FRY_COLUMN_ID, columnById } from "@/lib/columns";
import { useVoice } from "@/lib/use-voice";
import { cn } from "@/lib/cn";
import type { GrillQuestion, Ticket } from "@/lib/types";
import { PayloadEditor, useStagePayload } from "./PayloadEditor";

export function GrillRoom({ ticket }: { ticket: Ticket }) {
  const runTicket = useBoardStore((s) => s.runTicket);
  const submitGrill = useBoardStore((s) => s.submitGrill);
  const patchGrillQuestion = useBoardStore((s) => s.patchGrillQuestion);
  const members = useBoardStore((s) => s.config.members);
  const docs = useBoardStore((s) => s.config.docs);
  const execution = useBoardStore((s) => s.config.execution);
  const columns = useBoardStore((s) => s.config.columns);
  const activeMemberId = useBoardStore((s) => s.activeMemberId);
  const busy = ticket.status === "executing";
  const openRound = [...ticket.grillRounds].reverse().find((r) => !r.submitted);
  const spec = ticket.outputs.synthesize || "";
  const col = columnById(FRY_COLUMN_ID, columns);
  const step = resolveStep(col, execution);
  const voice = useVoice();
  const [voiceCursor, setVoiceCursor] = useState<number | null>(null);
  const payload = useStagePayload(ticket);

  const done = answeredCount(openRound?.questions ?? []);
  const total = openRound?.questions.length ?? 0;

  if (!openRound && !ticket.fryComplete) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Grill the spec from Synthesize. {step.label} runs the Grill Me skill. The team answers every question — typed or spoken. Those answers are what Write plan reads.
        </p>
        <SpecBlock spec={spec} />
        <DocsLine docs={docs} />
        <PayloadEditor
          payload={payload.payload}
          onChange={payload.setPayload}
          loading={payload.loading}
          error={payload.error}
          dirty={payload.dirty}
          onRegenerate={() => void payload.regenerate()}
        />
        <Button
          variant="primary"
          size="md"
          className="w-full"
          disabled={busy || payload.loading || !payload.payload}
          onClick={() => void runTicket(ticket.id, payload.payload ?? undefined)}
        >
          {busy ? <RotateCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
          {busy ? "Grilling…" : `Start grill · ${step.label}`}
        </Button>
      </div>
    );
  }

  if (ticket.fryComplete) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-micro uppercase tracking-wider text-subtle">Settled — feeds Write plan</p>
        {ticket.grillRounds.map((r, i) => (
          <div key={r.id}>
            <p className="text-micro text-subtle">Round {i + 1}</p>
            <ul className="mt-1 flex flex-col gap-2">
              {r.questions.map((q) => (
                <li key={q.n} className="rounded-md border border-border bg-inset p-3 text-sm">
                  <p className="font-medium">{q.n}. {q.question}</p>
                  <p className="mt-1 text-muted">{q.answer || q.recommended}</p>
                  {q.answeredBy ? <p className="mt-1 text-2xs text-subtle">{q.answeredBy}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {ticket.outputs.fry ? (
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-inset p-3 font-sans text-sm leading-relaxed">
            {ticket.outputs.fry}
          </pre>
        ) : null}
      </div>
    );
  }

  if (!openRound) return null;
  const round = openRound;

  function save(q: GrillQuestion, patch: Partial<GrillQuestion>) {
    patchGrillQuestion(ticket.id, round.id, q.n, patch);
  }

  function speakQuestion(q: GrillQuestion) {
    setVoiceCursor(q.n);
    voice.speak(`${q.n}. ${q.question}. Recommended: ${q.recommended}`);
  }

  function dictate(q: GrillQuestion) {
    setVoiceCursor(q.n);
    voice.listen((text) => {
      const next = [q.answer, text].filter(Boolean).join(" ").trim();
      save(q, { answer: next, assigneeId: activeMemberId });
    });
  }

  function readAll() {
    const script = round.questions
      .map((q) => `Question ${q.n}. ${q.question}. Recommended: ${q.recommended}.`)
      .join(" ");
    voice.speak(script);
  }

  return (
    <div className="flex flex-col gap-3">
      <SpecBlock spec={spec} compact />
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-micro uppercase tracking-wider text-subtle">
          Round {ticket.grillRounds.length} · {done}/{total} answered · {step.label}
        </p>
        <button
          type="button"
          className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm text-muted hover:text-fg"
          onClick={() => (voice.speaking ? voice.stopSpeak() : readAll())}
        >
          {voice.speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          {voice.speaking ? "Stop" : "Read all"}
        </button>
      </div>
      {!voice.canListen ? (
        <p className="text-2xs text-muted">Voice answers need Chrome or Edge on this machine.</p>
      ) : null}

      {round.questions.map((q) => {
        const mine = q.assigneeId === activeMemberId;
        const member = members.find((m) => m.id === q.assigneeId);
        return (
          <article
            key={q.n}
            className={cn("rounded-md border bg-inset p-3", mine ? "border-accent" : "border-border")}
          >
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium leading-snug">
                {q.n}. {q.question}
              </p>
              <button
                type="button"
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg"
                aria-label="Read question"
                onClick={() => speakQuestion(q)}
              >
                <Volume2 className="size-4" />
              </button>
            </div>
            {q.source ? <p className="mt-1 text-2xs uppercase tracking-wider text-subtle">from {q.source}</p> : null}
            <button
              type="button"
              className="mt-2 w-full rounded-sm border border-border bg-elevated px-2 py-2 text-left text-2xs text-muted hover:text-fg"
              onClick={() => save(q, { answer: q.recommended, assigneeId: activeMemberId })}
            >
              Rec: {q.recommended}
            </button>
            <div className="mt-2 flex gap-2">
              <select
                className="h-11 min-w-0 flex-1 rounded-md border border-border bg-elevated px-2 text-sm"
                value={q.assigneeId ?? ""}
                aria-label={`Assign question ${q.n}`}
                onChange={(e) => save(q, { assigneeId: e.target.value || undefined })}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={cn(
                  "flex size-11 items-center justify-center rounded-md border",
                  voice.listening && voiceCursor === q.n ? "border-accent text-accent" : "border-border text-muted",
                )}
                aria-label={voice.listening && voiceCursor === q.n ? "Stop dictation" : "Dictate answer"}
                onClick={() => (voice.listening ? voice.stopListen() : dictate(q))}
              >
                <Mic className="size-4" />
              </button>
            </div>
            <Textarea
              className="mt-2 min-h-16 text-sm"
              value={q.answer}
              onChange={(e) => save(q, { answer: e.target.value, assigneeId: q.assigneeId ?? activeMemberId })}
              placeholder={member ? `${member.name}'s answer — or tap rec / mic` : "Answer — tap rec or mic"}
            />
            {q.answeredBy ? <p className="mt-1 text-2xs text-subtle">{q.answeredBy}</p> : null}
          </article>
        );
      })}

      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="md"
          className="flex-1"
          onClick={() => {
            for (const q of round.questions) {
              if (!q.answer.trim()) save(q, { answer: q.recommended, assigneeId: q.assigneeId ?? activeMemberId });
            }
          }}
        >
          Fill recs
        </Button>
        <Button
          variant="primary"
          size="md"
          className="flex-1"
          disabled={busy}
          onClick={() => {
            const payload: Record<number, string> = {};
            for (const q of round.questions) {
              payload[q.n] = (q.answer || q.recommended).trim();
            }
            void submitGrill(ticket.id, payload);
          }}
        >
          {busy ? <RotateCw className="size-3.5 animate-spin" /> : null}
          {done < total ? `Submit ${done}/${total}` : "Submit round"}
        </Button>
      </div>
    </div>
  );
}

function SpecBlock({ spec, compact }: { spec: string; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  if (!spec) {
    return <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted">No spec yet. Run Synthesize first so Grill Me has a document to talk to.</p>;
  }
  return (
    <div className="rounded-md border border-border bg-elevated">
      <button
        type="button"
        className="flex h-11 w-full items-center justify-between px-3 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        Spec from Synthesize
        <span className="text-2xs font-normal text-subtle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <pre className={cn("whitespace-pre-wrap border-t border-border p-3 font-sans text-sm leading-relaxed text-muted", compact && "max-h-36 overflow-auto")}>
          {spec}
        </pre>
      ) : null}
    </div>
  );
}

function DocsLine({ docs }: { docs: { id: string; title: string }[] }) {
  if (docs.length === 0) return null;
  return (
    <p className="text-2xs text-subtle">
      Docs in play: {docs.map((d) => d.title).join(" · ")}
    </p>
  );
}
