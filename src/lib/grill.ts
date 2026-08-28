import type { GrillQuestion, TeamMember, Ticket } from "./types";

export function assignQuestions(questions: GrillQuestion[], members: TeamMember[]): GrillQuestion[] {
  if (members.length === 0) return questions;
  return questions.map((q, i) => ({
    ...q,
    assigneeId: q.assigneeId || members[i % members.length]?.id,
  }));
}

export function formatGrillRecord(ticket: Ticket): string {
  if (ticket.grillRounds.length === 0) return ticket.outputs.fry || "";
  const rounds = ticket.grillRounds
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
  const conclusions = ticket.fryComplete ? `\n\nConclusions:\n${ticket.outputs.fry || ""}` : "";
  return `${rounds}${conclusions}`.trim();
}

export function answeredCount(questions: GrillQuestion[]): number {
  return questions.filter((q) => q.answer.trim().length > 0).length;
}
