# Pit Discovery

Team workspace for the Discovery pipeline. One stage at a time: brief → agenda → notes → spec → **Grill Me** → backlog → Jira.

Each stage picks its own agent — **Cursor**, **Claude**, **GenAI Studio**, or **CIS** — running as a local CLI or a remote HTTP endpoint. Grill Me interviews the spec from Synthesize. The crew answers every question (typed or spoken). Those answers are what Write plan consumes.

## Quick start

```bash
git clone https://github.com/akash1233/pit-discovery.git
cd pit-discovery
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

Node 22+. Chrome or Edge if you want Grill Me voice (read-aloud + dictation).

## Hook up a real agent (local first)

Until a CLI is on PATH, **Team → Execution → Test default agent** will say `agent` / `claude` is missing. Demo text is a fallback only.

1. Install [Cursor CLI](https://cursor.com) so `agent` is on your PATH, and/or [Claude Code](https://docs.anthropic.com/en/docs/claude-code) so `claude` is on PATH.
2. `cp .env.example .env.local` and keep `PIT_DEMO_FALLBACKS=0`.
3. Restart `npm run dev`.
4. **Team → Execution → Test default agent** should report the binary path.
5. Uncheck **Use demo text if the agent is offline**.

Default CLI commands (editable in Execution):

| Agent | Command |
| --- | --- |
| Cursor | `agent -p --output-format text` |
| Claude | `claude -p --output-format text` |

Optional: point **Local HTTP sidecar** at an OpenAI-compatible server (`http://127.0.0.1:11434/v1`) instead of spawning a CLI.

## Per-stage agents

**Team → Pipeline** pins the agent on each runnable stage. **Inherit** uses the workspace default.

Shipped defaults:

| Stage | Agent |
| --- | --- |
| Agenda, Spec | Cursor |
| Grill, Backlog | Claude |
| Everything else | Inherit |

**Team → Execution** is where that agent *lives*:

- Cursor local / remote URL
- Claude local / remote URL
- GenAI Studio: `POST /v1alpha/prediction/cis/generate/{promptId}` with `wd-pca-feature-key`
- CIS: `POST /cis/v1alpha1/predictions` (no API token — feature key is your user id)

Env vars in [`.env.example`](.env.example) override the UI on the server. Full matrix: [docs/SETUP.md](docs/SETUP.md).

## Grill Me

1. Run **Spec** (Synthesize) so the ticket has a spec.
2. Open **Grill**. Start grill — questions come from the spec plus **Team → Docs** (the Grill Me skill lives there).
3. Questions are assigned around the crew. Header **Working as** is who you are.
4. Answer each one: type, tap the rec, or the mic. **Read all** speaks the frontier.
5. Submit the round. Write plan treats those answers as binding.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node tests (agents, grill, platform checks) |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |

Workspace state (tickets, team, docs, execution) is in `localStorage` key `pit-studio-v2`. **Reset** restores sample tickets. **Team → Look → Reset team** restores pipeline defaults.

## Layout

```
src/components/studio/   UI — rail, tickets, Grill room, team settings
src/lib/columns.ts       Pipeline + prompts
src/lib/execution.server.ts  Cursor / Claude spawn, Studio, CIS
src/lib/discovery-agent.ts   Per-stage prompts
src/lib/grill-skill.ts   Grill Me skill (also editable in Team → Docs)
```
