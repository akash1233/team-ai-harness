import type { GrillQuestion, Plan, Ticket } from "./types";
import {
  FRY_COLUMN_ID,
  PLAN_JSON_END,
  PLAN_JSON_START,
  PREP_AGENDA_COLUMN_ID,
  SYNTHESIZE_COLUMN_ID,
  WRITE_PLAN_COLUMN_ID,
} from "./columns";

export type Fallback = {
  text: string;
  plan?: Plan;
  grill?: { frontierEmpty: boolean; questions: GrillQuestion[] };
};

function q(n: number, question: string, recommended: string): GrillQuestion {
  return { n, question, recommended, answer: "", source: "spec" };
}

export function fallbackFor(ticket: Ticket, columnId: string, grillSubmit?: boolean): Fallback {
  if (columnId === PREP_AGENDA_COLUMN_ID) {
    const text = `## Team Discussion Agenda — ${ticket.key} ${ticket.title}

### 1. Problem / Goals / Metrics
${ticket.description}
Success: operators can complete the Discovery loop without leaving the board. Quantify by time-to-plan and wrong-skill incidents.

### 2. Users / Personas / Stories
- As an operator, I want the live contract on the ticket.
- As an admin, I want to publish copy without a deploy.

### 3. Research
Existing Pit columns already store outputs on the ticket. Mirror the Plan system-prompt chip.

### 4. Features / UI / API
Read-only prompt drawer, pin on start, optional per-ticket override. Responsive board already.

### 5. Risks / Out of scope / Tech
Fence untrusted Jira description. Out of scope: Sana ingest, GitHub PRs. Tests on precedence.

### 6. Priorities
Ship the drawer and pin this iteration. Figma not required.

Record the full meeting (transcript ingest is manual for now).`;
    return { text };
  }

  if (columnId === SYNTHESIZE_COLUMN_ID) {
    const text = `## Problem Statement
${ticket.description}

## Solution
Carry a versioned prompt (and optional override) on the ticket so every Discovery agent reads the same contract.

## User Stories
1. As an operator, I want the prompt on the ticket, so I can audit the run.
2. As an admin, I want to publish versions without a deploy.
3. As Fryme, I want a pinned sha, so mid-run edits cannot change questions.
4. As security, I want Jira description fenced, so it cannot become system prompt.

## Implementation Decisions
- Registry keyed by workflow + column.
- Precedence: ticket override > pin > default. Missing pin fails closed.
- Do not let the model rewrite the prompt.

## Testing Decisions
- External behavior only: the run payload contains the override when set.
- Precedence matrix. Fail-closed on missing pin.

## Out of Scope
Sana auto-ingest, Conduit, Main XO execute, inventing extra Jira issues.

## Further Notes
Decisions already on the ticket should not be re-derived in Fryme.`;
    return { text };
  }

  if (columnId === FRY_COLUMN_ID) {
    const answered = ticket.grillRounds.filter((r) => r.submitted).length;
    if (grillSubmit && answered >= 1) {
      const conclusions = `## Fryme conclusions — ${ticket.key}

Decisions
- Prompt registry keyed by workflow + column. Tickets pin a sha at start.
- Precedence: override > pin > default. Missing pin → PIT_BLOCKED, no repo-skill fallback.
- Runs are read-only on the pinned text. Admins publish; operators may fork.
- Jira description is a fenced user block, never concatenated into the system prompt.

Remaining risks
- Override text is privileged — treat like a skill file, not like an issue comment.
- Pin drift if an admin unpublishes a version still referenced by in-flight tickets.

Do not re-derive storage vs Jira custom field. Registry + pin is settled.`;
      return {
        text: "```json\n" + JSON.stringify({ frontierEmpty: true, questions: [], conclusions }) + "\n```\n\n" + conclusions,
        grill: { frontierEmpty: true, questions: [] },
      };
    }

    const questions = [
      q(
        1,
        "Where do prompts live — Jira custom field, ticket blob, or a registry keyed by column?",
        "Registry keyed by workflow + column. Ticket stores a pin {columnId, sha}, not the full text.",
      ),
      q(
        2,
        "Who can edit, and can a run see a mid-flight publish?",
        "Admins publish. Operators may fork a per-ticket override. Runs pin at start and stay read-only.",
      ),
      q(
        3,
        "What happens if the pin is missing — repo skill fallback or fail closed?",
        "Fail closed with [PIT_BLOCKED: no pinned prompt]. Silent fallback is how the current bug survived.",
      ),
      q(
        4,
        "How is untrusted Jira description kept out of the system prompt?",
        "Pass it in a fenced user block. Never concatenate description into the system prompt.",
      ),
    ];
    return {
      text: "```json\n" + JSON.stringify({ frontierEmpty: false, questions }, null, 2) + "\n```",
      grill: { frontierEmpty: false, questions },
    };
  }

  if (columnId === WRITE_PLAN_COLUMN_ID) {
    const plan: Plan = {
      summary: `${ticket.key} ${ticket.title}. Carry versioned Discovery prompts on the ticket so grill/plan agents read a pinned contract instead of repo skills.`,
      findings: [
        "Operators cannot audit the live prompt.",
        "Silent repo-skill fallback hid the bug.",
        "Plan column already has a system-prompt chip — replicate, don't invent a new pattern.",
      ],
      scope: [
        "Prompt registry + pin + optional override",
        "Prompt chip on every prompt column",
        "Fail closed when pin is missing",
      ],
      outOfScope: ["Sana ingest", "Conduit", "Main XO execute", "GitHub PRs"],
      risks: [
        "Override text is privileged",
        "Unpublished versions still pinned on in-flight tickets",
      ],
      steps: [
        {
          title: "Epic: Prompt registry for Discovery columns",
          detail: "Store markdown prompts keyed by workflow + column with sha, publisher, and immutable versions.",
          references: [],
        },
        {
          title: "Story: Pin prompt version on ticket start",
          detail: "When a ticket enters a prompt column, pin {columnId, sha}. The run reads only the pin.",
          references: ["Epic: Prompt registry for Discovery columns"],
        },
        {
          title: "Story: Per-ticket override fork",
          detail: "Operators may fork the pinned text onto the ticket. Precedence: override > pin > default.",
          references: ["Epic: Prompt registry for Discovery columns"],
        },
        {
          title: "Story: Prompt chip in column headers",
          detail: "Mirror the Plan 'system prompt' chip on every prompt column. Drawer is read-only for operators.",
          references: ["Epic: Prompt registry for Discovery columns"],
        },
        {
          title: "Story: Fail closed on missing pin",
          detail: "If a run has no pin, print [PIT_BLOCKED: no pinned prompt] and stop. No repo-skill fallback.",
          references: ["Epic: Prompt registry for Discovery columns"],
        },
      ],
    };
    return {
      plan,
      text: `Backlog for ${ticket.key}.\n\n${PLAN_JSON_START}\n${JSON.stringify(plan, null, 2)}\n${PLAN_JSON_END}`,
    };
  }

  return { text: `Completed ${columnId} for ${ticket.key}.` };
}
