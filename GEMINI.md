# Gemini Plugin for Claude Code — Gemini CLI Context

## Project Overview

This is a Claude Code plugin that wraps Google's Gemini CLI for code reviews and task delegation. If you're working on this codebase with Gemini CLI, here's what you need to know.

## Architecture

This plugin communicates with the `gemini` binary via ACP (Agent Communication Protocol) — a JSON-RPC 2.0 protocol over stdin/stdout. It spawns `gemini --acp` as a child process, creates a session, and exchanges structured messages. There is no broker or app server.

The plugin provides these Claude Code slash commands:
- `/gemini:review` — standard code review
- `/gemini:adversarial-review` — challenge review questioning design choices
- `/gemini:rescue` — delegate tasks to Gemini
- `/gemini:status`, `/gemini:result`, `/gemini:cancel` — job management
- `/gemini:setup` — installation and auth check

## Tech Stack

- Node.js 18.18+ ESM (`.mjs` files, no TypeScript)
- Zero npm dependencies (stdlib only)
- No build step required
- Tests: `node --test tests/*.test.mjs`

## Key Entry Points

- `plugins/gemini/scripts/gemini-companion.mjs` — main CLI that dispatches all commands
- `plugins/gemini/scripts/lib/gemini.mjs` — core integration with `gemini` binary (spawning, output parsing, auth detection)
- `plugins/gemini/scripts/lib/render.mjs` — Markdown output formatting
- `plugins/gemini/scripts/lib/state.mjs` — persistent job/config state

## Model Aliases

The plugin maps short names to full model identifiers:
- `pro` → `gemini-3.1-pro`
- `flash` → `gemini-3-flash`
- `flash-lite` → `gemini-2.5-flash-lite`

These are defined in `plugins/gemini/scripts/lib/models.mjs` in the `MODEL_ALIASES` map. The default model (when no `--model` flag is passed) is `gemini-3.1-pro`.

## How Reviews Work

Reviews use ACP in read-only mode (`session/set_mode` with `modeId: "plan"`):
1. Collect git diff context (`lib/git.mjs`)
2. Build a review prompt from templates in `plugins/gemini/prompts/`
3. Embed the JSON schema from `plugins/gemini/schemas/review-output.schema.json`
4. Send the prompt via `session/prompt` over ACP
5. Parse the structured JSON from the response

## Testing

Tests use a fake `gemini` binary (`tests/fake-gemini-fixture.mjs`) that simulates the ACP protocol. No real API calls are made during tests.

```bash
node --test tests/*.test.mjs
```

## Common Modifications

- **Review prompts**: `plugins/gemini/prompts/review.md` and `adversarial-review.md`
- **Model defaults**: `DEFAULT_MODEL` and `MODEL_ALIASES` in `plugins/gemini/scripts/lib/models.mjs`
- **Output formatting**: `plugins/gemini/scripts/lib/render.mjs`
- **New commands**: Add `.md` in `plugins/gemini/commands/` + handler in `gemini-companion.mjs`
