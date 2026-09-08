import { FRY_COLUMN_ID } from "./columns.ts";
import type { FryQuestion, TeamMember, Ticket } from "./types";

export function assignQuestions(questions: FryQuestion[], members: TeamMember[]): FryQuestion[] {
  if (members.length === 0) return questions;
  return questions.map((q, i) => ({
    ...q,
    assigneeId: q.assigneeId || members[i % members.length]?.id,
  }));
}

export function fryConclusions(ticket: Pick<Ticket, "outputs">): string {
  return (ticket.outputs[FRY_COLUMN_ID] || ticket.outputs.fry || "").trim();
}

export function formatFryRecord(ticket: Ticket): string {
  if (ticket.fryRounds.length === 0) return fryConclusions(ticket);
  const rounds = ticket.fryRounds
    .map((r, i) => {
      const qs = r.questions
        .map((q) => {
          const who = q.answeredBy ? ` (${q.answeredBy})` : q.assigneeId ? ` [assigned]` : "";
          return `${q.n}. ${q.question}\n   Rec: ${q.recommended}\n   Answer${who}: ${q.answer || "(pending)"}`;
        })
        .join("\n");
      return `Round ${i + 1}${r.submitted ? "" : " (open)"}:\n${qs}`;
    })
    .join("\n\n");
  const conclusions = ticket.fryComplete ? `\n\nConclusions:\n${fryConclusions(ticket)}` : "";
  return `${rounds}${conclusions}`.trim();
}

export function answeredCount(questions: FryQuestion[]): number {
  return questions.filter((q) => q.answer.trim().length > 0).length;
}
