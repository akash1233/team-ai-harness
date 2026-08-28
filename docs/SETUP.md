# Mac and org setup

Operator guide for running **Team AI Harness** on a Mac and pointing it at Workday GenAI Studio / CIS.

Repo: [github.com/akash1233/team-ai-harness](https://github.com/akash1233/team-ai-harness)

## Prerequisites (Mac)

- macOS with zsh (default)
- Homebrew
- Node.js 22+
- Chrome or Edge for Grill Me voice
- For real runs: Cursor CLI (`agent` or `cursor-agent`) and/or Claude Code (`claude`)

```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node -v          # v22.x
which agent || which cursor-agent || echo "install Cursor CLI"
which claude || echo "install Claude Code"
```

Intel Macs: Homebrew is `/usr/local` instead of `/opt/homebrew`. Use that path.

## Install the app

```bash
git clone https://github.com/akash1233/team-ai-harness.git
cd team-ai-harness
cp .env.example .env.local
npm install
npm run dev
```

The app binds `0.0.0.0:8080`. Start it from **Terminal or iTerm**, not by double-clicking — GUI-launched Node does not inherit your `~/.zshrc` PATH, so `agent` / `claude` look missing.

`npm run dev` loads `.env` / `.env.local` through `scripts/with-app-env.mjs`. Do not start Vite directly.

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

If the binary is `cursor-agent`, set **Cursor command** to `cursor-agent -p --output-format text`.

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
2. **Team → Execution → Test setup**.
3. You want a path like `/Users/you/.local/bin/agent`, not “not on PATH”.
4. Uncheck **Use demo text if the agent is offline**.

## Environment

Copy [`.env.example`](../.env.example). Every `PIT_*` key overrides **Team → Execution**.

| Variable | Meaning |
| --- | --- |
| `PIT_DEFAULT_AGENT` | `cursor` \| `claude` \| `studio` \| `cis` for Inherit stages |
| `PIT_CURSOR_TARGET` / `PIT_CLAUDE_TARGET` | `local` or `remote` |
| `PIT_CURSOR_COMMAND` | Default `agent -p --output-format text` |
| `PIT_CLAUDE_COMMAND` | Default `claude -p --output-format text` |
| `PIT_LOCAL_HTTP_URL` | OpenAI-compatible sidecar; skips CLI if set |
| `PIT_CURSOR_REMOTE_URL` / `PIT_CLAUDE_REMOTE_URL` | Remote HTTP agent |
| `PIT_STUDIO_BASE_URL` | GenAI Studio host, no trailing slash |
| `PIT_FEATURE_KEY` | `wd-pca-feature-key` — your user id, not an API token |
| `PIT_PROMPT_ID` | Studio prompt id (`File → Copy Prompt ID`) |
| `PIT_CIS_MODEL` | e.g. `anthropic.claude-haiku-4-5-20251001-v1:0` |
| `PIT_DEMO_FALLBACKS` | `0` fail closed, `1` canned text when the agent is missing |

Restart the dev server after changing env.

## First-run checklist

1. Open the app → **Team → Execution**. Follow the Mac steps, then **Test setup**.
2. **Pipeline**: Agenda/Spec = Cursor, Grill/Backlog = Claude (shipped defaults).
3. **Docs**: Grill Me skill + Discovery conventions.
4. Run Spec on a ticket, then Start grill. Answer as the person in **Working as**.

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
