# Pipeline flow specs

Kindling stage lists, agents, prompts, and variable contracts live here as JSON. **Edit these files to change the pipeline** — the board loads this on boot. Settings → Pipeline / Prompts edits apply for the session only and are wiped on reload.

## Discovery flow

**File:** [`discovery.flow.json`](./discovery.flow.json)

Stages: Brief → Agenda → Review agenda → Notify → Notes → Spec → Fry Me → Backlog → File → Done.

## Quick spec flow (default)

**File:** [`quick-spec.flow.json`](./quick-spec.flow.json)

Stages copied from Discovery stage 05 onward: Add Sana Transcript → Spec → Review spec → Fry Me → Review Fry Me → Plan → Sign-off → File Jira → Done. No Brief, Agenda, or Slack.

Loader: [`src/lib/flow-spec.ts`](../src/lib/flow-spec.ts) (`columnsFromFlowSpec`, `resolveFlowStagePrompt`, `listFlowVariables`). There is no extra hardcoded Blocked column.

## System variables

Use any token below in a stage `prompt.system` or `prompt.user` string. If a token is not named in the prompt, it is **not** sent to the agent.

### Pipeline outputs

| Token | Description | Set when |
| --- | --- | --- |
| `{{brief}}` | Brief composed text (Slack + notes) | Brief Save |
| `{{agenda}}` | Full agenda document | Agenda Run |
| `{{transcript}}` | Meeting notes | Notes Save |
| `{{spec}}` | Spec document | Spec Run |
| `{{fryme}}` | Fry Me Q&A record | Fry Me rounds / harvest |
| `{{plan}}` | Backlog plan JSON string | Backlog Run |
| `{{jira_filed}}` | Created epic/story keys | After File Jira harvest |
| `{{slack_post}}` | Notify post summary | After Slack MCP |
| `{{prev}}` | Last stage output | Every harvest |

### Slack

| Token | Description | Set when |
| --- | --- | --- |
| `{{slackChannel}}` | Channel name (no `#`) | Brief Save |
| `{{slackChannelId}}` | Channel ID (`C…`) | Brief Save |
| `{{slack.channel}}` | Alias for channel name | Brief Save |
| `{{slack.members}}` | Notify roster handles | Brief Save |
| `{{slackMessage}}` | Composed post body (header + agenda) | Notify stage entry |
| `{{slack.ts}}` | Posted message timestamp | After Notify harvest |

### Jira (multi-select on Brief page)

| Token | Description |
| --- | --- |
| `{{jiraProject}}` | Project key for createNewJiraTicket (from ticket key, e.g. `X2`) |
| `{{jiraComponents}}` | Component names from **Settings → Team**. Override on the ticket or in stage test. Empty → Cursor asks or copies from a linked issue |
| `{{jira}}` | **All** selected issues: `KEY title` + description each, blank-line separated |
| `{{jira.key}}`, `{{jira.title}}`, `{{jira.description}}`, `{{jira.status}}`, `{{jira.url}}` | **First** linked issue only |
| `{{jira.X2-698}}` | Full block for one issue (key varies) |
| `{{jira.X2-698.description}}` | One issue's description only |

### Repo (when linked)

| Token | Description |
| --- | --- |
| `{{repo}}`, `{{repo.fullName}}`, `{{repo.url}}`, `{{repo.branch}}`, `{{repo.description}}` | GitHub repo from Brief Jira & repo pane |

### Ticket metadata

| Token | Description |
| --- | --- |
| `{{ticket.key}}`, `{{ticket.title}}`, `{{ticket.description}}`, `{{ticket.labels}}` | Ticket card fields (description is user-typed only, not auto-filled from Jira) |

### Computed (opt-in)

| Token | Description |
| --- | --- |
| `{{context}}` | Auto-aggregated dump of filled vars — use only if the prompt names it |
| `{{docs}}` | Attached skill documents (Fry Me) |
| `{{input}}` | Generic manual capture |
| `{{frymePhase}}` | Fry Me round instruction (submit vs start) — Fry Me stage only |

## Designing a new stage prompt

1. Add or edit a stage in `discovery.flow.json` with `prompt.system` and `prompt.user`.
2. Reference only the `{{variables}}` you need from the table above.
3. Put business rules in `prompt.system` (e.g. "use every attached Jira, not just the first").
4. On Cursor/Claude stages, set `"cli": "print"` (one-shot `-p`) or `"cli": "tui"` (interactive Terminal). Omit = print. WebLLM/manual/review ignore it.
5. Run `npm run test:kindling` — `flow-spec.test.ts` validates tokens against the catalog.

The board boots on Quick spec. Switch to Discovery in the header **Flow** menu.
