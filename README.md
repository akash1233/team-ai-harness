# Team AI Harness

Team workspace for running a Discovery pipeline with **Cursor**, **Claude**, **GenAI Studio**, or **CIS**. Stages publish variables. Grill Me interviews the spec. Spend is token-priced from Anthropic-style rates.

Repo: [github.com/akash1233/team-ai-harness](https://github.com/akash1233/team-ai-harness)

## Quick start (Mac)

Need Node 22+ and Homebrew if you do not already have them.

```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

git clone https://github.com/akash1233/team-ai-harness.git
cd team-ai-harness
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080). Chrome or Edge for Grill Me voice.

Click the green **Settings** control in the header. Every workspace option lives there.

## Settings (all of it)

The **Settings** gear in the header is the control plane. Nothing about the pipeline is hardcoded for the team except starter defaults.

| Tab | What you configure |
| --- | --- |
| **Team** | Name, Jira prefix, Slack channel, **people** (name / handle / role), labels |
| **Flows** | Multiple pipelines. Add, duplicate, delete. Auto-advance and auto-run |
| **Pipeline** | Stage order, labels, role, **agent per stage**, output variable |
| **Prompts** | Prompt templates (`{{spec}}`, `{{grill}}`, …) and per-stage Studio prompt IDs |
| **Docs** | Grill Me skill + notes the grill reads |
| **Execution** | Default agent, Cursor/Claude local vs remote, Studio/CIS, **Test Cursor / Test Claude**, MCP list, **token pricing** |
| **Look** | Vertical vs horizontal board, theme, density, show spend |

Env vars in [`.env.example`](.env.example) override Execution. Full Mac/agent matrix: [docs/SETUP.md](docs/SETUP.md).

## Spend ($)

Each agent call adds dollars to the ticket. Rates are **Settings → Execution → Token pricing** (USD per million tokens).

- **Studio / CIS / HTTP sidecar:** uses `usage.input_tokens` / `output_tokens` (Anthropic), `prompt_tokens` / `completion_tokens` (OpenAI), or `inputTokens` / `outputTokens` (Bedrock).
- **Local Cursor / Claude CLI:** no usage object, so tokens are estimated as `characters / chars-per-token` (default 4).
- **Demo fallbacks:** $0 — canned text is not billed.

Shipped defaults match Anthropic list prices (Aug 2026):

| Agent | Input / MTok | Output / MTok |
| --- | --- | --- |
| Claude, Cursor, Studio | $2 | $10 (Sonnet 5) |
| CIS | $1 | $5 (Haiku 4.5, the CIS default model) |

Formula: `(inputTokens × inputRate + outputTokens × outputRate) / 1_000_000`. Change the rates if your org uses Opus, Haiku, or a different Cursor model. Header total is the sum of tickets. Each run log line shows `$` and token counts.

## Hook up Cursor / Claude on a Mac

The harness spawns a CLI. Until `agent` or `claude` is on PATH, **Settings → Execution → Test Cursor** / **Test Claude** will fail the CLI check.

**Cursor Agent**

```bash
curl https://cursor.com/install -fsS | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
which agent || which cursor-agent
agent --version
```

If only `cursor-agent` exists, set Cursor command to `cursor-agent -p --output-format text`.

**Claude Code**

```bash
curl -fsSL https://claude.ai/install.sh | bash
# or: brew install --cask claude-code
which claude && claude --version
```

Then restart `npm run dev` **from that Terminal**, Test Cursor and Test Claude, uncheck demo fallbacks. Uncheck connectivity-only to send your prompt on Haiku / Composer. **Test Claude MCP** runs `claude mcp list`.

## Flows and variables

A workspace can run **multiple flows**. Switch them in the header or Settings → Flows. Tickets stay on the flow they were created in.

Each stage publishes a named value. Later prompts interpolate it:

| Token | Source |
| --- | --- |
| `{{brief}}` | Brief / ideation |
| `{{agenda}}` | Agenda |
| `{{transcript}}` | Meeting notes |
| `{{spec}}` | Synthesize |
| `{{grill}}` | Grill Me answers |
| `{{plan}}` | Backlog plan |
| `{{prev}}` | Previous stage output |
| `{{ticket.title}}` | Ticket fields |

With **Keep running agent stages** on, a successful run skips review gates and starts the next agent until notes, Grill questions, or sign-off.

## Per-stage agents

**Settings → Pipeline** pins the agent on each runnable stage. **Inherit** uses the workspace default.

| Stage | Default agent |
| --- | --- |
| Agenda, Spec | Cursor |
| Grill, Backlog | Claude |
| Everything else | Inherit |

## Grill Me

1. Run **Spec**.
2. Open **Grill**. Start grill — questions come from the spec plus **Settings → Docs**.
3. Header **Working as** is who you are. Answer: type, rec, or mic.
4. Submit the round. Write plan treats those answers as binding.

## Layout (modules)

```
src/components/studio/           Board chrome
  Studio.tsx                     Header, layout switch, Settings
  StageRail.tsx / TicketList.tsx Vertical pipeline
  PipelineBoard.tsx / TicketNote Horizontal sticky-note board
  RunLog.tsx                     Agent output + spend + tokens
  GrillRoom.tsx                  Collaborative grill
  settings/                      Settings tabs helpers
    field.tsx                    Shared fields
    PricingFields.tsx            Token rates UI
  TeamSettings.tsx               Settings shell + tabs

src/lib/
  types.ts                       Shared types
  team-config.ts                 Defaults + merge (localStorage)
  columns.ts                     Discovery / Quick spec stages + prompts
  flow-context.ts                {{var}} interpolate / harvest
  agents.ts                      Resolve Cursor/Claude/Studio/CIS per stage
  execution.server.ts            Spawn CLI, HTTP, Studio, CIS
  pricing.ts                     Token usage + USD
  discovery-agent.ts             Per-stage prompts → runModel
  grill.ts / grill-skill.ts      Grill parse + skill doc
  board-store.ts                 Zustand persistence
```

Workspace state: `localStorage` key `pit-studio-v2`. **Reset** restores sample tickets. **Settings → Look → Restore default team** restores pipeline defaults.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node tests (agents, grill, flow-context, **pricing**) |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |
