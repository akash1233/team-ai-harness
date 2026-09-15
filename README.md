# Kindling

A team board that turns a discovery conversation into a spec, a plan, and Jira issues. Each stage can run **Cursor**, **Claude**, **GenAI Studio**, **CIS**, or in-browser **WebLLM**.

Work stays on your machine (`localStorage`). It is not shared across laptops.

## Run it

Need Node 22+ (Homebrew on a Mac).

```bash
git clone ghegit@ghe.megaleo.com:workday/kindling.git
cd kindling
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) in Chrome or Edge (needed for Fry Me voice).

Start `npm run dev` from **Terminal**, not Finder or a GUI-launched editor — otherwise Cursor/Claude will look missing on PATH.

Mac and org agent setup: [docs/SETUP.md](docs/SETUP.md).

## Pipelines

**Quick spec** is the default. Paste a transcript, then spec → Fry Me → plan → File Jira → Done. Defined in [`flows/quick-spec.flow.json`](flows/quick-spec.flow.json).

**Discovery** is the longer path (Brief → Agenda → Slack → then the same transcript-to-Jira stages). Defined in [`flows/discovery.flow.json`](flows/discovery.flow.json).

Switch flows in the header **Flow** menu. Tickets stay on the flow they were created in. **Settings → Pipeline** edits last for this session only; persist real changes in those JSON files. Variable catalog: [`flows/README.md`](flows/README.md).

## Try it

1. Open **Settings** (gear in the header) → **Execution**. Install Cursor CLI and/or Claude Code, then **Test Cursor** / **Test Claude**. Uncheck demo fallbacks for real runs.
2. **Team** — people, Slack channel + ID, Jira prefix.
3. **Connect** — Jira / GitHub Enterprise PATs if you want live issues and repos on a ticket.
4. On the board, open the sample ticket. Paste a Sana transcript → **Save & advance**.
5. Run each stage in order. Review and Fry Me are human gates. File Jira opens Terminal so you can approve `jira-ghe` tool calls.

**Working as** in the header is who answers Fry Me.

**Reset** in the header restores one empty sample ticket at Add Sana Transcript. It does not change team settings.

## Test one stage

Use this when you want to exercise Agenda, Spec, Fry Me, Plan, or File Jira without walking the whole pipeline.

1. Drag the ticket onto that column (or run the pipeline up to it).
2. Check **Test this stage** on the ticket panel, or **Settings → Pipeline → Test** on that step.
3. The panel lists every `{{variable}}` the stage reads, seeded from last stages. Edit any field to override.
4. Run. The ticket **stays on this stage** — it will not auto-advance.

**Reset from last stages** clears overrides. Uncheck Test when you want the normal pipeline again. The Test flag is session-only.

## Agents

| Stage (defaults) | Who runs it |
| --- | --- |
| Agenda, Spec, Plan | Cursor, print (one-shot) |
| Notify, File Jira | Cursor, TUI (approve tools in Terminal) |
| Fry Me | Claude, print |
| Brief, transcript | You |

**Settings → Pipeline** can pin a different agent per stage for this session. **Inherit** uses **Settings → Execution** (or `DEFAULT_AGENT` in `.env`).

Notify needs **slack-mcp** on Cursor. File Jira needs **jira-ghe** (`createNewJiraTicket`). Use **Settings → Execution → Test Cursor MCP**. Close the Terminal window when the agent is done, or **Done — harvest & continue** on the ticket.

Cursor binary should be `cursor-agent`, not `agent` (that is often Grok). Details: [docs/SETUP.md](docs/SETUP.md).

## Settings

| Tab | What it is |
| --- | --- |
| **Team** | Name, Jira prefix, Jira components, Slack channel / ID, people, labels |
| **Flows** | Pipelines, auto-advance, auto-run, continue-into-another-flow |
| **Pipeline** | Stage order, agent, print vs TUI, prompt, published variable, **Test** |
| **Prompts** | Prompt library. Stages pick one. Skills can be attached |
| **Skills** | Docs Fry Me (and other prompts) can append |
| **Connect** | Jira + GitHub Enterprise hosts and PATs |
| **WebLLM** | In-browser models |
| **Execution** | Default agent, CLI commands, Studio / CIS, MCP tests, token pricing |
| **Look** | Vertical vs horizontal board (default: vertical), theme, density, spend |

`.env` / `.env.local` override Execution. Restart `npm run dev` after env changes. Jira and GitHub PATs are Connect only, not env.

## Spend

Each agent call adds dollars to the ticket. Rates: **Settings → Execution → Token pricing**.

- Studio / CIS / HTTP: billed from the API usage object.
- Local Cursor / Claude: estimated as characters ÷ 4 (default).
- Demo fallbacks and WebLLM: $0.

Header total is the sum of tickets. Each run log line shows `$` and token counts.

## State

Browser `localStorage` key `kindling-v1`. Not synced. Two people on two Macs do not share a board.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm test` | Node tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
