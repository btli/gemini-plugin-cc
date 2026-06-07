# Antigravity Plugin for Claude Code

## Project Structure

This is a Claude Code plugin that wraps Google's Antigravity CLI (`agy`) for code reviews and task delegation.
It mirrors the architecture of [codex-plugin-cc](https://github.com/openai/codex-plugin-cc); the original
Gemini CLI (ACP) backend was replaced with agy print-mode subprocess execution.

## Key Architecture

- **Print mode**: Spawns `agy --print` per run, prompt via stdin — no persistent server or JSON-RPC layer
- **Conversations**: agy conversation IDs parsed from its `--log-file` glog, stored in job state, resumed with `--conversation`
- **Review isolation**: reviews run in disposable git worktrees (agy has no read-only mode)
- **Model fallback detection**: agy silently falls back on unknown `--model` values; the plugin detects this from the log and fails loudly
- **Structured output**: prompt-based JSON (no native schema enforcement)
- **Default model**: `Gemini 3.1 Pro (High)` (alias `pro`; configurable via `--model`)

## Development

- Runtime: Node.js ESM (`.mjs` files)
- Tests: `node --test tests/*.test.mjs`
- No build step required

## File Layout

- `plugins/antigravity/` — the plugin root
- `plugins/antigravity/.claude-plugin/plugin.json` — plugin manifest
- `plugins/antigravity/scripts/antigravity-companion.mjs` — main CLI orchestrator
- `plugins/antigravity/scripts/lib/antigravity.mjs` — task/review execution facade, shutdown handling
- `plugins/antigravity/scripts/lib/agy-cli.mjs` — agy print-mode subprocess layer (args, log parsing, watchdog)
- `plugins/antigravity/scripts/lib/review-worktree.mjs` — disposable worktree lifecycle for reviews
- `plugins/antigravity/scripts/lib/models.mjs` — model display labels, aliases, DEFAULT_MODEL
- `plugins/antigravity/scripts/lib/` — shared utilities (args, fs, git, process, state, etc.)
- `plugins/antigravity/commands/` — slash command definitions (.md)
- `plugins/antigravity/agents/` — subagent definitions (.md)
- `plugins/antigravity/skills/` — skill definitions
- `plugins/antigravity/prompts/` — prompt templates
- `plugins/antigravity/hooks/` — hook definitions
