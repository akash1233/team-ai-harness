# Team AI Harness

Team workspace for the Discovery pipeline. One stage at a time: brief → agenda → notes → spec → **Grill Me** → backlog → Jira.

Each stage picks its own agent — **Cursor**, **Claude**, **GenAI Studio**, or **CIS** — running as a local CLI (Mac) or a remote HTTP endpoint. Grill Me interviews the spec from Synthesize. The crew answers every question (typed or spoken). Those answers are what Write plan consumes.

Repo: [github.com/akash1233/team-ai-harness](https://github.com/akash1233/team-ai-harness)

## Quick start (Mac)

Need Node 22+ and Homebrew if you do not already have them.

```bash
# Node
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

git clone https://github.com/akash1233/team-ai-harness.git
cd team-ai-harness
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080). Use Chrome or Edge for Grill Me voice.

Then **Team → Execution** and follow the Mac agent steps on that page.

## Hook up Cursor / Claude on a Mac

The harness spawns a CLI. Until `agent` or `claude` is on PATH, **Test default agent** will say the binary is missing.

**Cursor Agent**

```bash
curl https://cursor.com/install -fsS | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
which agent || which cursor-agent
agent --version
```

If only `cursor-agent` exists, in **Team → Execution** set Cursor command to:

```
cursor-agent -p --output-format text
```

**Claude Code**

```bash
curl -fsSL https://claude.ai/install.sh | bash
# or: brew install --cask claude-code
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
which claude
claude --version
```

Then:

1. Quit and re-run `npm run dev` **from the same Terminal** (Finder-launched Node will not see your zsh PATH).
2. **Team → Execution → Test default agent** should print a path under `~/.local/bin`.
3. Uncheck **Use demo text if the agent is offline**.

Optional: point **Local HTTP sidecar** at an OpenAI-compatible server (`http://127.0.0.1:11434/v1`) instead of spawning a CLI.

## Per-stage agents

**Team → Pipeline** pins the agent on each runnable stage. **Inherit** uses the workspace default.

Shipped defaults:

| Stage | Agent |
| --- | --- |
| Agenda, Spec | Cursor |
| Grill, Backlog | Claude |
| Everything else | Inherit |

**Team → Execution** is where that agent *lives*: Cursor/Claude local vs remote, or GenAI Studio / CIS (feature key = your user id, no API token).

Env vars in [`.env.example`](.env.example) override the UI. Full matrix: [docs/SETUP.md](docs/SETUP.md).

## Grill Me

1. Run **Spec** so the ticket has a spec.
2. Open **Grill**. Start grill — questions come from the spec plus **Team → Docs**.
3. Header **Working as** is who you are. Answer: type, rec, or mic.
4. Submit the round. Write plan treats those answers as binding.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node tests |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |

Workspace state lives in `localStorage` (`pit-studio-v2`). **Reset** restores sample tickets. **Team → Look → Reset team** restores pipeline defaults.

## Layout

```
src/components/studio/   UI — rail, tickets, Grill room, team settings
src/lib/columns.ts       Pipeline + prompts
src/lib/execution.server.ts  Cursor / Claude spawn, Studio, CIS
src/lib/discovery-agent.ts   Per-stage prompts
src/lib/grill-skill.ts   Grill Me skill (also editable in Team → Docs)
```
