# Gemini Plugin for Claude Code

## Project Structure

This is a Claude Code plugin that wraps Google's Gemini CLI for code reviews and task delegation.
It mirrors the architecture of [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) but
replaces the Codex app server with direct ACP (Agent Communication Protocol) communication.

## Key Architecture

- **ACP protocol**: Spawns `gemini --acp` and communicates via JSON-RPC 2.0 over stdin/stdout
- **No broker/app-server**: Direct subprocess — no persistent server or broker process
- **Structured output**: Prompt-based (no native schema enforcement)
- **Sessions**: ACP session IDs stored in job state, resumed with `--resume`
- **Default model**: `gemini-3.1-pro` (configurable via `--model` flag or `.gemini/settings.json`)

## Development

- Runtime: Node.js ESM (`.mjs` files)
- Tests: `node --test tests/*.test.mjs`
- No build step required

## File Layout

- `plugins/gemini/` — the plugin root
- `plugins/gemini/.claude-plugin/plugin.json` — plugin manifest
- `plugins/gemini/scripts/gemini-companion.mjs` — main CLI orchestrator
- `plugins/gemini/scripts/lib/gemini.mjs` — core task/review execution, shutdown handling
- `plugins/gemini/scripts/lib/acp-lifecycle.mjs` — ACP client lifecycle, session creation/resume, timeouts
- `plugins/gemini/scripts/lib/acp-client.mjs` — low-level JSON-RPC 2.0 client over stdin/stdout
- `plugins/gemini/scripts/lib/models.mjs` — model aliases and DEFAULT_MODEL
- `plugins/gemini/scripts/lib/` — shared utilities (args, fs, git, process, state, etc.)
- `plugins/gemini/commands/` — slash command definitions (.md)
- `plugins/gemini/agents/` — subagent definitions (.md)
- `plugins/gemini/skills/` — skill definitions
- `plugins/gemini/prompts/` — prompt templates
- `plugins/gemini/hooks/` — hook definitions
