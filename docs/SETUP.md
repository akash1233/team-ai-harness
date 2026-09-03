# Mac and org setup

Operator guide for running **Kindling** on a Mac and pointing it at Workday GenAI Studio / CIS.

Repo: [github.com/akash1233/team-ai-harness](https://github.com/akash1233/team-ai-harness)

## Prerequisites (Mac)

- macOS with zsh (default)
- Homebrew
- Node.js 22+
- Chrome or Edge for Grill Me voice
- For real runs: Cursor CLI (`cursor-agent`) and/or Claude Code (`claude`)

```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node -v          # v22.x
which cursor-agent || echo "install Cursor CLI"
which claude || echo "install Claude Code"
```

Intel Macs: Homebrew is `/usr/local` instead of `/opt/homebrew`. Use that path.

## Install the app

```bash
git clone https://github.com/akash1233/team-ai-harness.git
cd team-ai-harness
cp .env.example .env
npm install
npm run dev
```

The app binds `0.0.0.0:8080`. Start it from **Terminal or iTerm**, not by double-clicking — GUI-launched Node does not inherit your `~/.zshrc` PATH, so `cursor-agent` / `claude` look missing.

`npm run dev` loads `.env` then `.env.local` through `scripts/with-app-env.mjs`. Do not start Vite directly. Restart after any env change.

## Install agents (Mac)

These same steps are printed on **Team → Execution**.

### Cursor Agent

```bash
curl https://cursor.com/install -fsS | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
agent --version || cursor-agent --version
```

Docs: [cursor.com/docs/cli/installation](https://cursor.com/docs/cli/installation)

Use **`cursor-agent`**, not `agent` — on PATH `agent` is often Grok. Set **Cursor command** to `cursor-agent -p --output-format text` (or `PIT_CURSOR_COMMAND`).

### Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | bash
# or: brew install --cask claude-code
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
claude --version
```

### After install

1. Stop the harness (`Ctrl+C`) and run `npm run dev` again in that same shell.
2. **Settings → Execution → Test Cursor** and **Test Claude**.
3. You want a path like `/Users/you/.local/bin/cursor-agent`, not “not on PATH”. Settings → Execution → Resolved CLIs shows Cursor vs Grok.
4. Uncheck **Use demo text if the agent is offline**.

## Environment

Copy [`.env.example`](../.env.example) to `.env`. Put machine-specific overrides in `.env` (gitignored). Every `PIT_*` key overrides **Settings → Execution**. Jira / GitHub PATs are **Settings → Connect**, not env.

| Variable | Meaning |
| --- | --- |
| `PIT_LOG_LEVEL` | `silent` \| `error` \| `warn` \| `info` \| `debug`. Vite terminal + **Settings → Execution → App log**. Default `info`. |
| `PIT_DEFAULT_AGENT` | Inherit stages: `cursor` \| `claude` \| `studio` \| `cis` \| `webllm` |
| `PIT_CURSOR_TARGET` / `PIT_CLAUDE_TARGET` | `local` or `remote` |
| `PIT_CURSOR_COMMAND` | Default `cursor-agent -p --output-format text` (not Grok’s `agent`) |
| `PIT_CLAUDE_COMMAND` | Default `claude -p --output-format text` |
| `PIT_CURSOR_EXTRA_ARGS` / `PIT_CLAUDE_EXTRA_ARGS` | Extra CLI flags. Cursor default `--trust -f` if unset |
| `PIT_WORKSPACE` | Cursor `--workspace` / trust root. Empty = cwd of `npm run dev` |
| `PIT_RUN_IN_TERMINAL` | `1` open Terminal.app (Mac), `0` off |
| `PIT_FULL_AGENT` | `1` yolo / dontAsk / `-f`. Workday blocks this outside a dev container |
| `PIT_TIMEOUT_MS` | Test / HTTP probe timeout. Default `120000` |
| `PIT_STAGE_TIMEOUT_MS` | Non-interactive stage wait. Default `300000` (5 min) |
| `PIT_NOTIFY_MCP_SETTLE_MS` | Notify auto-harvest delay after MCP success. Default `15000`. `0` = immediate |
| `PIT_DEMO_FALLBACKS` | `0` fail closed, `1` canned text when the agent is missing |
| `PIT_WEBLLM_PROFILE` | `fast` \| `balanced` \| `quality` |
| `PIT_WEBLLM_MODEL` | Optional custom WebLLM model id |
| `PIT_LOCAL_HTTP_URL` | OpenAI-compatible sidecar; skips CLI if set |
| `PIT_CURSOR_REMOTE_URL` / `PIT_CLAUDE_REMOTE_URL` | Remote HTTP agent |
| `PIT_STUDIO_BASE_URL` | GenAI Studio host, no trailing slash |
| `PIT_FEATURE_KEY` | `wd-pca-feature-key` — your user id, not an API token |
| `PIT_PROMPT_ID` | Studio prompt id (`File → Copy Prompt ID`) |
| `PIT_CIS_PROVIDER` / `PIT_CIS_MODEL` / `PIT_CIS_TASK_TYPE` | CIS converse target |
| `PIT_CHARS_PER_TOKEN` | CLI token estimate (default 4) |
| `PIT_*_IN_USD_PER_MTOK` / `PIT_*_OUT_USD_PER_MTOK` | Pricing for `CLAUDE`, `CURSOR`, `STUDIO`, `CIS` |

Restart the dev server after changing env.

## First-run checklist

1. Open the app → **Settings** (green gear in the header) → **Execution**. Follow the Mac steps, then **Test Cursor** and **Test Claude**. **Test Claude MCP** lists MCP servers (`claude mcp list`).
2. **Pipeline**: Agenda/Spec = Cursor, Grill/Backlog = Claude (shipped defaults).
3. **Docs**: Grill Me skill + Discovery conventions.
4. **Execution → Token pricing**: rates used for the $ on tickets. Studio/CIS use API usage when present; local CLI estimates characters ÷ 4.
5. Run Spec on a ticket, then Start grill. Answer as the person in **Working as**.

## GenAI Studio / CIS

No bearer token. The gateway authenticates with `wd-pca-feature-key`.

Studio:

```
POST {PIT_STUDIO_BASE_URL}/v1alpha/prediction/cis/generate/{promptId}
Header: wd-pca-feature-key: {PIT_FEATURE_KEY}
Body: { "inputArgs": { "prompt": "..." } }
```

CIS converse:

```
POST {PIT_STUDIO_BASE_URL}/cis/v1alpha1/predictions
Header: wd-pca-feature-key: {PIT_FEATURE_KEY}
```

Pin a stage to **Studio** or **CIS** in Pipeline, or set the workspace default for Inherit.

## Remote Cursor / Claude

When `PIT_CURSOR_TARGET=remote`, the harness `POST`s the prompt to `PIT_CURSOR_REMOTE_URL`. Same for Claude.

- If the URL contains `/v1` or `chat/completions`, the payload is OpenAI chat completions.
- Otherwise `{ agent, system, user, prompt, maxTokens }`.

## Troubleshooting (Mac)

| Symptom | Fix |
| --- | --- |
| `agent` not on PATH | Install Cursor CLI, add `~/.local/bin` to `~/.zshrc`, restart Terminal, restart `npm run dev` |
| Test works in Terminal, fails in the app | You started Node from Finder / VS Code without the zsh PATH. Launch `npm run dev` from Terminal |
| Binary is `cursor-agent` not `agent` | Change Cursor command to `cursor-agent -p --output-format text` |
| Grill produces canned questions | Demo fallbacks are on, or the CLI failed. Turn fallbacks off |
| Studio 4xx | Base URL, prompt id, and feature key (user id) |
| Voice mic does nothing | Chrome/Edge, allow microphone on localhost |
| `EACCES` on `npm install` | Never use `sudo npm`. Fix npm prefix or use a node from Homebrew |

State lives in the browser (`localStorage`). It is not shared across Macs until you add a backend.
