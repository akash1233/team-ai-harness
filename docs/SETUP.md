# Local and org setup

This is the operator guide for running Pit Discovery on a laptop and pointing it at Workday GenAI Studio / CIS.

## Prerequisites

- Node.js 22+
- npm 10+
- Chrome or Edge for Grill Me voice
- For real runs: Cursor CLI (`agent`) and/or Claude Code (`claude`) on PATH

```bash
node -v   # v22.x
which agent || echo "install Cursor CLI"
which claude || echo "install Claude Code"
```

## Install

```bash
git clone https://github.com/akash1233/pit-discovery.git
cd pit-discovery
cp .env.example .env.local
npm install
npm run dev
```

The app binds `0.0.0.0:8080`. Do not start Vite directly — `npm run dev` loads `.env.local` through `scripts/with-app-env.mjs`.

## Environment

Copy [`.env.example`](../.env.example). Every `PIT_*` key overrides **Team → Execution**.

| Variable | Meaning |
| --- | --- |
| `PIT_DEFAULT_AGENT` | `cursor` \| `claude` \| `studio` \| `cis` for Inherit stages |
| `PIT_CURSOR_TARGET` / `PIT_CLAUDE_TARGET` | `local` or `remote` |
| `PIT_CURSOR_COMMAND` | Default `agent -p --output-format text` |
| `PIT_CLAUDE_COMMAND` | Default `claude -p --output-format text` |
| `PIT_LOCAL_HTTP_URL` | OpenAI-compatible sidecar; skips CLI if set |
| `PIT_CURSOR_REMOTE_URL` / `PIT_CLAUDE_REMOTE_URL` | `POST` body `{ agent, system, user, prompt, maxTokens }` (or `/v1/chat/completions`) |
| `PIT_STUDIO_BASE_URL` | GenAI Studio host, no trailing slash |
| `PIT_FEATURE_KEY` | `wd-pca-feature-key` — your user id, not an API token |
| `PIT_PROMPT_ID` | Studio prompt id (`File → Copy Prompt ID`) |
| `PIT_CIS_MODEL` | e.g. `anthropic.claude-haiku-4-5-20251001-v1:0` |
| `PIT_DEMO_FALLBACKS` | `0` fail closed, `1` canned text when the agent is missing |

Restart the dev server after changing env.

## First-run checklist

1. Open the app → **Team → Execution → Test default agent**.
2. You want a path to `agent` or `claude`, not “not on PATH”.
3. Uncheck **Use demo text if the agent is offline**.
4. **Pipeline**: Agenda/Spec = Cursor, Grill/Backlog = Claude (shipped defaults).
5. **Docs**: Grill Me skill + Discovery conventions. Add design docs the grill should cite.
6. Run Spec on a ticket, then Start grill. Answer as the person in **Working as**.

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

`target.model` comes from **CIS model**. Pin a stage to **Studio** or **CIS** in Pipeline, or set the workspace default to Studio/CIS for Inherit.

## Remote Cursor / Claude

When `PIT_CURSOR_TARGET=remote`, Pit `POST`s the prompt to `PIT_CURSOR_REMOTE_URL`. Same for Claude.

- If the URL contains `/v1` or `chat/completions`, the payload is OpenAI chat completions (`model` is `cursor` or `claude`).
- Otherwise the payload is `{ agent, system, user, prompt, maxTokens }`. Response text is taken from `text`, `output.message.content[].text`, or OpenAI `choices`.

Use this for a team gateway that already runs Cursor/Claude on a worker, not for Cursor Cloud Agents (those clone a git repo).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Test connection: `agent` not on PATH | Install Cursor CLI; confirm `which agent`; restart the server |
| Grill produces canned questions | Demo fallbacks are on, or the CLI failed. Turn fallbacks off to see the real error |
| Studio 4xx | Base URL, prompt id, and feature key (user id) |
| Voice mic does nothing | Chrome/Edge, and allow microphone on localhost |
| Old tickets after pull | Header **Reset** (samples) or **Team → Look → Reset team** (pipeline) |

State lives in the browser (`localStorage`). It is not shared across machines until you add a backend.
