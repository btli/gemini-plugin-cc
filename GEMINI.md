# Gemini Plugin for Claude Code — Gemini CLI Context

## Project Overview

This is a Claude Code plugin that wraps Google's Gemini CLI for code reviews and task delegation. If you're working on this codebase with Gemini CLI, here's what you need to know.

## Architecture

This plugin invokes the `gemini` binary as a subprocess from within Claude Code. It does NOT use any app server or persistent connection — each review or task spawns a fresh `gemini` process with `-o json` for structured output.

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

These are defined in `plugins/gemini/scripts/lib/gemini.mjs` in the `MODEL_ALIASES` map.

## How Reviews Work

Since there's no native review RPC (unlike Codex), all reviews are prompt-based:
1. Collect git diff context (`lib/git.mjs`)
2. Build a review prompt from templates in `plugins/gemini/prompts/`
3. Embed the JSON schema from `plugins/gemini/schemas/review-output.schema.json`
4. Run `gemini -p "<prompt>" -o json --approval-mode plan`
5. Parse the structured JSON from the response

## Testing

Tests use a fake `gemini` binary (`tests/fake-gemini-fixture.mjs`) that simulates `-o json` and `-o stream-json` output formats. No real API calls are made during tests.

```bash
node --test tests/*.test.mjs
```

## Common Modifications

- **Review prompts**: `plugins/gemini/prompts/review.md` and `adversarial-review.md`
- **Model defaults**: `MODEL_ALIASES` in `plugins/gemini/scripts/lib/gemini.mjs`
- **Output formatting**: `plugins/gemini/scripts/lib/render.mjs`
- **New commands**: Add `.md` in `plugins/gemini/commands/` + handler in `gemini-companion.mjs`
