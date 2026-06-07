# Antigravity Plugin for Claude Code — Agent Instructions

## Project Overview

This is a Claude Code plugin that wraps Google's Antigravity CLI (`agy`) for code reviews and task delegation. It provides `/antigravity:*` slash commands that invoke the `agy` binary as a subprocess.

Based on the architecture of [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) by OpenAI, originally adapted for Gemini CLI (ACP) and now ported to Antigravity print mode.

## Architecture

- **Print mode**: Spawns `agy --print` per task/review with the prompt written to stdin. No persistent server, broker, or JSON-RPC layer.
- **Conversation tracking**: agy's per-job glog (`--log-file`) is parsed for `Print mode: conversation=<uuid>` and the propagated model label. Conversation IDs are stored in job state (the `sessionId` field) and resumed with `agy --conversation <id>`.
- **Model fallback detection**: `--model` only accepts agy display labels (e.g. `Gemini 3.1 Pro (High)`); anything else silently falls back to Flash Medium. The facade compares the requested label with the propagated label from the log and fails loudly on mismatch.
- **Review isolation**: agy has no read-only mode and auto-approves file writes in print mode. Reviews therefore run inside a disposable detached git worktree (`lib/review-worktree.mjs`) that mirrors the working state; stray writes land in the throwaway worktree. Orphaned worktrees older than 24h are swept at review start.
- **Structured output**: Reviews request JSON via prompt engineering. No native schema enforcement.
- **Background jobs**: Detached Node.js worker processes with SIGTERM-based graceful cancellation (worker SIGTERM → SIGTERM to the agy child → agy cancels its conversation) and partial output preservation.
- **Timeouts**: agy's own `--print-timeout` is the primary bound; a Node watchdog at timeout+30s catches hung processes.

## Tech Stack

- **Runtime**: Node.js 18.18+ ESM (`.mjs` files throughout)
- **Package manager**: bun (no npm/yarn/pnpm)
- **Tests**: `node --test tests/*.test.mjs` (Node.js built-in test runner)
- **No build step**: All source is plain JavaScript, no TypeScript compilation
- **No external dependencies**: Zero npm packages — stdlib only

## Key Files

| File | Role |
|---|---|
| `plugins/antigravity/scripts/lib/antigravity.mjs` | Core facade — task/review execution, auth detection, shutdown handling, output post-processing |
| `plugins/antigravity/scripts/lib/agy-cli.mjs` | agy print-mode subprocess layer — arg building, log parsing, watchdog |
| `plugins/antigravity/scripts/lib/review-worktree.mjs` | Disposable git worktree lifecycle for review isolation |
| `plugins/antigravity/scripts/lib/models.mjs` | Model display labels, aliases, default model |
| `plugins/antigravity/scripts/antigravity-companion.mjs` | Main CLI orchestrator — dispatches setup, review, task, status, result, cancel |
| `plugins/antigravity/scripts/lib/render.mjs` | Markdown output formatting for all commands |
| `plugins/antigravity/scripts/lib/state.mjs` | Persistent state management (jobs, config) |
| `plugins/antigravity/scripts/lib/git.mjs` | Git operations for review context collection |
| `plugins/antigravity/scripts/lib/job-control.mjs` | Job enrichment, status snapshots, result resolution |
| `plugins/antigravity/scripts/lib/tracked-jobs.mjs` | Job lifecycle tracking with progress reporting |
| `plugins/antigravity/hooks/hooks.json` | SessionStart/End/Stop hook definitions |
| `plugins/antigravity/prompts/review.md` | Standard code review prompt template |
| `plugins/antigravity/prompts/adversarial-review.md` | Adversarial review prompt template |

## Plugin Structure

```
plugins/antigravity/
├── .claude-plugin/plugin.json    # Plugin manifest
├── agents/                       # Subagent definitions
├── commands/                     # Slash command definitions (.md with frontmatter)
├── hooks/hooks.json              # Hook definitions
├── prompts/                      # Prompt templates for reviews
├── schemas/                      # JSON schemas for structured output
├── scripts/                      # Node.js runtime code
│   ├── antigravity-companion.mjs # Main entry point
│   ├── session-lifecycle-hook.mjs
│   ├── stop-review-gate-hook.mjs
│   └── lib/                      # Shared modules
└── skills/                       # Skill definitions with references
```

## Model Aliases

Model IDs are agy display labels (the only form `agy --model` resolves):

- `pro` → `Gemini 3.1 Pro (High)` (default)
- `pro-low` → `Gemini 3.1 Pro (Low)`
- `flash` → `Gemini 3.5 Flash (High)`
- `flash-medium` → `Gemini 3.5 Flash (Medium)`
- `flash-low` → `Gemini 3.5 Flash (Low)`
- `sonnet` → `Claude Sonnet 4.6 (Thinking)`
- `opus` → `Claude Opus 4.6 (Thinking)`
- `gpt-oss` → `GPT-OSS 120B (Medium)`

Defined in `plugins/antigravity/scripts/lib/models.mjs`. Unknown values pass through verbatim (agy supports custom models in its settings); silent fallback is detected post-run.

## How Reviews Work

1. Collect git diff context (`lib/git.mjs`) — embedded directly in the prompt
2. Build a review prompt from templates in `plugins/antigravity/prompts/`
3. Embed the JSON schema from `plugins/antigravity/schemas/review-output.schema.json`
4. Create a disposable git worktree mirroring the working state (`lib/review-worktree.mjs`)
5. Run `agy --print` with cwd = worktree (read access to repo files, writes isolated)
6. Parse the structured JSON from stdout; strip worktree paths from output
7. Remove the worktree

## Development Conventions

- All source files use `.mjs` extension (ESM)
- No TypeScript — plain JavaScript with JSDoc where helpful
- State stored in `$CLAUDE_PLUGIN_DATA` or `$TMPDIR/antigravity-companion/`
- Environment variable prefix: `ANTIGRAVITY_COMPANION_*`
- Tests use a fake `agy` binary fixture (`tests/fake-agy-fixture.mjs`) — no real API calls

## Running Tests

```bash
node --test tests/*.test.mjs
```

## Common Tasks

- **Add a new command**: Create `plugins/antigravity/commands/<name>.md` with frontmatter, add handler in `antigravity-companion.mjs`
- **Change review prompts**: Edit `plugins/antigravity/prompts/review.md` or `adversarial-review.md`
- **Update model defaults**: Edit `DEFAULT_MODEL` and `MODEL_ALIASES` in `plugins/antigravity/scripts/lib/models.mjs`
- **Add a new skill**: Create `plugins/antigravity/skills/<name>/SKILL.md` with frontmatter
