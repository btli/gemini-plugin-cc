# Gemini Plugin for Claude Code

## Project Structure

This is a Claude Code plugin that wraps Google's Gemini CLI for code reviews and task delegation.
It mirrors the architecture of [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) but
replaces the Codex app server JSON-RPC protocol with direct Gemini CLI subprocess spawning.

## Key Architecture

- **No broker/app-server**: Gemini CLI is invoked directly as a subprocess
- **Structured output**: Prompt-based with `-o json` flag (no native schema enforcement)
- **Streaming**: `-o stream-json` for NDJSON progress events
- **Sessions**: Gemini session IDs stored in job state, resumed with `--resume`

## Development

- Runtime: Node.js ESM (`.mjs` files)
- Tests: `node --test tests/*.test.mjs`
- No build step required

## File Layout

- `plugins/gemini/` — the plugin root
- `plugins/gemini/.claude-plugin/plugin.json` — plugin manifest
- `plugins/gemini/scripts/gemini-companion.mjs` — main CLI orchestrator
- `plugins/gemini/scripts/lib/gemini.mjs` — core Gemini CLI integration
- `plugins/gemini/scripts/lib/` — shared utilities (args, fs, git, process, state, etc.)
- `plugins/gemini/commands/` — slash command definitions (.md)
- `plugins/gemini/agents/` — subagent definitions (.md)
- `plugins/gemini/skills/` — skill definitions
- `plugins/gemini/prompts/` — prompt templates
- `plugins/gemini/hooks/` — hook definitions
