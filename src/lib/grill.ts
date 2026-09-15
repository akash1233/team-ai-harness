import { FRY_COLUMN_ID } from "./columns.ts";
import type { FryQuestion, TeamMember, Ticket } from "./types";

export type FryQaItem = {
  n: number;
  round: number;
  question: string;
  recommended: string;
  answer: string;
  source?: string;
  answeredBy?: string;
};

export function assignQuestions(questions: FryQuestion[], members: TeamMember[]): FryQuestion[] {
  if (members.length === 0) return questions;
  return questions.map((q, i) => ({
    ...q,
    assigneeId: q.assigneeId || members[i % members.length]?.id,
  }));
}

export function fryConclusions(ticket: Pick<Ticket, "outputs" | "vars">): string {
  return (
    ticket.outputs[FRY_COLUMN_ID] ||
    ticket.outputs.fry ||
    ticket.vars?.["fryme.conclusions"] ||
    ""
  ).trim();
}

export function flattenFryQa(ticket: Pick<Ticket, "fryRounds">): FryQaItem[] {
  const items: FryQaItem[] = [];
  ticket.fryRounds.forEach((round, index) => {
    for (const q of round.questions) {
      items.push({
        n: items.length + 1,
        round: index + 1,
        question: q.question,
        recommended: q.recommended,
        answer: q.answer,
        source: q.source,
        answeredBy: q.answeredBy,
      });
    }
  });
  return items;
}

/** Per-question output vars later stages can read as {{fryme.1.answer}}, {{fryme.qa}}, … */
export function fryQuestionVars(ticket: Pick<Ticket, "fryRounds" | "outputs" | "vars">): Record<string, string> {
  const out: Record<string, string> = {};
  const items = flattenFryQa(ticket);
  for (const item of items) {
    out[`fryme.${item.n}.question`] = item.question;
    out[`fryme.${item.n}.recommended`] = item.recommended;
    out[`fryme.${item.n}.answer`] = item.answer;
    if (item.source) out[`fryme.${item.n}.source`] = item.source;
  }
  if (items.length) out["fryme.qa"] = JSON.stringify(items, null, 2);
  const conclusions = fryConclusions(ticket);
  if (conclusions) out["fryme.conclusions"] = conclusions;
  return out;
}

export function isFryVarKey(key: string): boolean {
  return key === "fryme" || key === "grill" || key === "fyyme" || key === "fry" || key.startsWith("fryme.");
}

export function stripFryVars(vars: Record<string, string>): Record<string, string> {
  const next = { ...vars };
  for (const key of Object.keys(next)) {
    if (isFryVarKey(key)) delete next[key];
  }
  return next;
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
