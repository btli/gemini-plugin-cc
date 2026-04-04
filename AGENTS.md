# Gemini Plugin for Claude Code — Agent Instructions

## Project Overview

This is a Claude Code plugin that wraps Google's Gemini CLI for code reviews and task delegation. It provides `/gemini:*` slash commands that invoke the `gemini` binary as a subprocess.

Based on the architecture of [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) by OpenAI, adapted for Gemini CLI.

## Architecture

- **No broker/app-server**: Unlike the codex plugin which uses JSON-RPC over Unix sockets, this plugin invokes `gemini` directly as a one-shot subprocess.
- **Structured output**: Reviews request JSON via prompt engineering + `-o json` flag. No native schema enforcement.
- **Background jobs**: Detached Node.js worker processes that spawn `gemini` and write results to state files.
- **Session management**: Gemini session IDs stored in job state, resumable with `--resume <session-id>`.

## Tech Stack

- **Runtime**: Node.js 18.18+ ESM (`.mjs` files throughout)
- **Package manager**: bun (no npm/yarn/pnpm)
- **Tests**: `node --test tests/*.test.mjs` (Node.js built-in test runner)
- **No build step**: All source is plain JavaScript, no TypeScript compilation
- **No external dependencies**: Zero npm packages — stdlib only

## Key Files

| File | Role |
|---|---|
| `plugins/gemini/scripts/lib/gemini.mjs` | Core Gemini CLI integration — availability checks, auth, subprocess spawning, output parsing |
| `plugins/gemini/scripts/gemini-companion.mjs` | Main CLI orchestrator — dispatches setup, review, task, status, result, cancel commands |
| `plugins/gemini/scripts/lib/render.mjs` | Markdown output formatting for all commands |
| `plugins/gemini/scripts/lib/state.mjs` | Persistent state management (jobs, config) |
| `plugins/gemini/scripts/lib/git.mjs` | Git operations for review context collection |
| `plugins/gemini/scripts/lib/job-control.mjs` | Job enrichment, status snapshots, result resolution |
| `plugins/gemini/scripts/lib/tracked-jobs.mjs` | Job lifecycle tracking with progress reporting |
| `plugins/gemini/hooks/hooks.json` | SessionStart/End/Stop hook definitions |
| `plugins/gemini/prompts/review.md` | Standard code review prompt template |
| `plugins/gemini/prompts/adversarial-review.md` | Adversarial review prompt template |

## Plugin Structure

```
plugins/gemini/
├── .claude-plugin/plugin.json    # Plugin manifest
├── agents/                       # Subagent definitions
├── commands/                     # Slash command definitions (.md with frontmatter)
├── hooks/hooks.json              # Hook definitions
├── prompts/                      # Prompt templates for reviews
├── schemas/                      # JSON schemas for structured output
├── scripts/                      # Node.js runtime code
│   ├── gemini-companion.mjs      # Main entry point
│   ├── session-lifecycle-hook.mjs
│   ├── stop-review-gate-hook.mjs
│   └── lib/                      # Shared modules
└── skills/                       # Skill definitions with references
```

## Model Aliases

- `pro` → `gemini-3.1-pro`
- `flash` → `gemini-3-flash`
- `flash-lite` → `gemini-2.5-flash-lite`

## Development Conventions

- All source files use `.mjs` extension (ESM)
- No TypeScript — plain JavaScript with JSDoc where helpful
- State stored in `$CLAUDE_PLUGIN_DATA` or `$TMPDIR/gemini-companion/`
- Environment variable prefix: `GEMINI_COMPANION_*`
- All Codex references from the upstream have been renamed to Gemini
- Tests use a fake `gemini` binary fixture (`tests/fake-gemini-fixture.mjs`) — no real API calls

## Running Tests

```bash
node --test tests/*.test.mjs
```

## Common Tasks

- **Add a new command**: Create `plugins/gemini/commands/<name>.md` with frontmatter, add handler in `gemini-companion.mjs`
- **Change review prompts**: Edit `plugins/gemini/prompts/review.md` or `adversarial-review.md`
- **Update model defaults**: Edit `MODEL_ALIASES` in `plugins/gemini/scripts/lib/gemini.mjs`
- **Add a new skill**: Create `plugins/gemini/skills/<name>/SKILL.md` with frontmatter
