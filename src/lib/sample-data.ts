import type { AgentResponse, Ticket } from "./types";
import {
  FRY_COLUMN_ID,
  IDEATION_COLUMN_ID,
  PREP_AGENDA_COLUMN_ID,
  PREVIEW_AGENDA_COLUMN_ID,
  SEND_SLACK_COLUMN_ID,
  SYNTHESIZE_COLUMN_ID,
  TRANSCRIPT_COLUMN_ID,
} from "./columns";

function iso(h: number, m: number, s = 0) {
  return new Date(Date.UTC(2026, 7, 28, h + 4, m, s)).toISOString();
}

function responses(): AgentResponse[] {
  const rows: Array<[string, string, string, string]> = [
    [PREP_AGENDA_COLUMN_ID, "08:12:04", "Agenda drafted", "Wrote the six-section team discussion agenda from the Jira problem statement."],
    [PREVIEW_AGENDA_COLUMN_ID, "08:14:22", "Agenda approved", "Operator approved the agenda without edits."],
    [SEND_SLACK_COLUMN_ID, "08:16:01", "Posted to Slack", "Posted verbatim to #get-dx-insights-test (C0BQMKFR519) ts=1756383361.428190."],
    [TRANSCRIPT_COLUMN_ID, "10:41:18", "Transcript captured", "Operator pasted the 42-minute working session notes."],
    [SYNTHESIZE_COLUMN_ID, "10:48:55", "Spec synthesized", "Structured notes: decisions, open questions, constraints for Fryme."],
    [PREP_AGENDA_COLUMN_ID, "11:02:11", "Prompt refresh", "Re-read Jira labels pit-processed, discovery."],
    [SYNTHESIZE_COLUMN_ID, "11:08:40", "User stories expanded", "Added operator + admin stories for prompt versioning."],
    [FRY_COLUMN_ID, "11:21:03", "Grill round queued", "Frontier mapped: storage, authz, versioning, Jira field vs registry."],
    [FRY_COLUMN_ID, "11:28:44", "Waiting on operator", "Round 1 questions posted. Recommended answers attached."],
    [FRY_COLUMN_ID, "11:34:32", "Agent response", "Held for operator replies before advancing the design tree."],
    [FRY_COLUMN_ID, "11:34:32", "Agent response", "Spend meter updated after the last completion call."],
  ];
  return rows.map(([columnId, time, summary, body], i) => ({
    id: `resp-${i + 1}`,
    at: `2026-08-28T${time}-04:00`,
    columnId,
    summary,
    body,
  }));
}

const AGENDA = `## Team Discussion Agenda — X2-698 Add Prompts in Jira BDD Assistant

### 1. Problem / Goals / Metrics
Operators cannot see or edit the Discovery column prompts that grill/plan agents actually run. Prompts live in repo skill files, so a Jira issue cannot carry the contract. Goal: attach versioned prompts on the issue. Success: 100% of Discovery tickets show the live prompt; zero "wrong skill" incidents in a two-week bake.

### 2. Users / Personas / Stories
- As an operator, I want the prompt on the ticket so I can audit what the agent will do.
- As a workflow admin, I want to publish a new prompt version without a deploy.
- As Fryme, I want a pinned prompt version so a mid-run edit cannot change the questions.

### 3. Research
Pit already stores column outputs on the ticket. Slack send uses a verbatim block. No prompt registry exists. Closest prior art: plan system prompt chip on the Plan column.

### 4. Features / UI / API
- Prompt drawer per column (read-only for operators, edit for admins).
- Pin prompt version on ticket start.
- Optional per-ticket override (fork).
- Flags: responsive board already; no new deps if we store markdown.

### 5. Risks / Out of scope / Tech
- Risk: prompt injection via Jira description — treat prompts as operator-authored, not model-authored.
- Out of scope: executing the Main XO lane; GitHub PRs; auto transcript ingest.
- Tech: 90%+ tests on parse + pin + override precedence.

### 6. Priorities
Figma not required — reuse the existing plan-system-prompt chip. Ship registry + pin this iteration.

Record the full meeting (transcript ingest is manual for now).`;

const TRANSCRIPT = `Maya: The BDD assistant still runs the hardcoded grill-me skill. Operators have no idea what they're approving.
Jon: We should not store prompts as Jira ADF blobs. A registry keyed by workflow + column, tickets pin a sha.
Priya: The Plan column already has a "plan system prompt" chip. Mirror that on every prompt column.
Maya: Overrides per ticket — rare, but Fryme on X2-698 needed a Discovery override last week.
Jon: Precedence: ticket override > pinned version > workflow default. Never silent fallback to repo skills once pinned.
Priya: Don't let the agent rewrite the prompt. Read-only in the run. Admin publishes.
Maya: Metrics — wrong-skill incidents, time-to-see-prompt, % tickets with a pin.
Jon: Out of scope: Sana auto-ingest, Conduit, creating Jira from Fryme.
Priya: Security: prompts are privileged. Don't interpolate untrusted Jira description into the system prompt without a fence.
Maya: Ship the drawer this sprint. Versioning can be immutable snapshots.`;

const SYNTHESIS = `## Problem Statement
Operators cannot inspect or version the prompts Discovery agents actually run. The contract lives in repo skills, so a ticket cannot carry it.

## Solution
A prompt registry keyed by workflow column. Tickets pin a version at start. Admins publish. Operators may fork a per-ticket override. The run is read-only on the pinned text.

## User Stories
1. As an operator, I want the live prompt on the ticket, so I can audit the run.
2. As an admin, I want to publish a new version without a deploy, so copy can move faster than code.
3. As an operator, I want a per-ticket override, so a one-off Discovery exception does not fork the default.
4. As Fryme, I want a pinned sha, so mid-run edits cannot change the questions.
5. As a reviewer, I want a prompt chip on every prompt column, so Plan is not a special case.
6. As security, I want untrusted Jira description fenced, so it cannot become system prompt.
7. As QA, I want precedence tests (override > pin > default), so silent fallbacks cannot happen.

## Implementation Decisions
- Registry is markdown + metadata (column id, semver, sha, publisher).
- Ticket stores pin {columnId, sha}. Override stores full text.
- UI: chip in column header opens the prompt drawer (matches Plan).
- Do not interpolate Jira description into the system prompt; pass it in a fenced user block.
- Slack send stays verbatim; prompts are unrelated to the posted agenda.

## Testing Decisions
- Test external behavior: given pin + override, the run payload contains override text.
- Precedence matrix. Missing pin fails closed with PIT_BLOCKED, does not load repo skill.
- Prior art: Slack verbatim post tests, plan JSON fence tests.

## Out of Scope
Sana ingest, Conduit, GitHub PRs, Main XO execute, rewriting prompts from the model.

## Further Notes
Fryme must not re-derive storage vs Jira-field — registry + pin is decided. Remaining grill: authz, immutable vs mutable versions, and whether Jira gets a pointer field.`;

export function createSampleTickets(): Ticket[] {
  return [
    {
      id: "t-x2-698",
      key: "X2-698",
      title: "Add Prompts in Jira BDD Assistant - X2",
      description:
        "Discovery agents run hardcoded skill files. Operators cannot see or version the prompt on the Jira issue. Attach a prompt registry + pin so grill/plan read the live contract.",
      labels: ["pit-processed", "discovery"],
      columnId: FRY_COLUMN_ID,
      status: "idle",
      spend: 1.32,
      runId: "c29615d1-07a4-4c2e-9f11-8b3e2a91d4c0",
      slackChannel: "get-dx-insights-test",
      slackChannelId: "C0BQMKFR519",
      slackMembers: "@maya @jon @priya",
      slackPosted: {
        channel: "get-dx-insights-test",
        channelId: "C0BQMKFR519",
        ts: "1756383361.428190",
      },
      ideationNotes:
        "Notify #get-dx-insights-test and @maya @jon @priya. This is the BDD assistant prompt-on-ticket initiative.",
      transcript: TRANSCRIPT,
      outputs: {
        [IDEATION_COLUMN_ID]:
          "Slack channel: #get-dx-insights-test\nChannel ID: C0BQMKFR519\nTeam members: @maya @jon @priya",
        [PREP_AGENDA_COLUMN_ID]: AGENDA,
        [SEND_SLACK_COLUMN_ID]:
          "Posted to #get-dx-insights-test (C0BQMKFR519) ts=1756383361.428190",
        [TRANSCRIPT_COLUMN_ID]: TRANSCRIPT,
        [SYNTHESIZE_COLUMN_ID]: SYNTHESIS,
      },
      agentResponses: responses(),
      grillRounds: [],
      fryComplete: false,
      plan: null,
      jiraCreated: [],
      createdAt: iso(7, 58),
    },
    {
      id: "t-x2-603",
      key: "X2-603",
      title: "Surface spend on Discovery cards",
      description:
        "Operators cannot tell what a ticket has cost until they open logs. Show a live spend figure on the card, sourced from agent completions.",
      labels: ["discovery", "dx"],
      columnId: PREVIEW_AGENDA_COLUMN_ID,
      status: "idle",
      spend: 0.18,
      runId: "a91c2e40-11b7-4d88-ae02-6f4c8d21b0aa",
      slackChannel: "get-dx-insights-test",
      slackChannelId: "C0BQMKFR519",
      slackMembers: "@maya",
      ideationNotes: "Slack: #get-dx-insights-test. Keep the meter read-only.",
      transcript: "",
      outputs: {
        [IDEATION_COLUMN_ID]:
          "Slack channel: #get-dx-insights-test\nChannel ID: C0BQMKFR519\nTeam members: @maya",
        [PREP_AGENDA_COLUMN_ID]: `## Team Discussion Agenda — X2-603 Surface spend on Discovery cards

### 1. Problem / Goals / Metrics
Cards hide cost. Goal: show spend on every in-flight ticket. Metric: operators can name the cost of a ticket without opening logs.

### 2. Users / Personas / Stories
As an operator, I want spend on the card so I can kill a runaway run.

### 3. Research
Existing meter lives in the agent response drawer only.

### 4. Features / UI / API
Read-only dollar figure, tabular nums, updates after each completion.

### 5. Risks / Out of scope / Tech
Do not bill-back to Jira. Out of scope: budgets, alerts.

### 6. Priorities
Ship the card meter this week.

Record the full meeting (transcript ingest is manual for now).`,
      },
      agentResponses: [
        {
          id: "r-603-1",
          at: iso(9, 4),
          columnId: PREP_AGENDA_COLUMN_ID,
          summary: "Agenda drafted",
          body: "Six-section agenda for the spend meter.",
        },
      ],
      grillRounds: [],
      fryComplete: false,
      plan: null,
      jiraCreated: [],
      createdAt: iso(8, 40),
    },
    {
      id: "t-x2-512",
      key: "X2-512",
      title: "Manual transcript ingest for Discovery",
      description:
        "Sana auto-ingest is not wired. Operators need a paste path on the ticket so Synthesize can run.",
      labels: ["discovery"],
      columnId: IDEATION_COLUMN_ID,
      status: "idle",
      spend: 0,
      runId: "e7b0c14f-88d2-4a19-9c55-0d2f6a18e4b1",
      slackChannel: "",
      slackChannelId: "",
      slackMembers: "",
      ideationNotes: "",
      transcript: "",
      outputs: {},
      agentResponses: [],
      grillRounds: [],
      fryComplete: false,
      plan: null,
      jiraCreated: [],
      createdAt: iso(12, 5),
    },
  ];
}

export const STORAGE_KEY = "pit-studio-v2";
