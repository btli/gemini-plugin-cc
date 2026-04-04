---
description: Internal helper contract for invoking the gemini-companion runtime from Claude Code. Used exclusively within the gemini:gemini-rescue subagent.
---

# Gemini CLI Runtime

This skill describes the internal contract for invoking the Gemini companion runtime.

## Primary helper

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task "<raw arguments>"
```

## Rules

- The rescue subagent is a forwarder, not an orchestrator.
- Its sole job is to invoke `task` once and return that stdout unchanged.
- Use `task` for all rescue requests: diagnosis, planning, research, and fixes.
- Do NOT call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from within rescue.
- Strip `--background` and `--wait` from the task text and pass them as flags.
- Leave `--model` unset unless the user explicitly requests a specific model.
- Model aliases: `flash` → `gemini-3-flash-preview`, `pro` → `gemini-3.1-pro-preview`, `auto` → `auto-gemini-3`.
- Default to write-capable runs by adding `--write` unless the user asks for read-only.
- `--resume` triggers `task --resume-last`.
- `--fresh` starts a clean `task` run.

## Safety

- Do NOT inspect the repository, read files, or perform independent analysis.
- Do NOT do follow-up work or progress monitoring.
- Return the `task` command's stdout exactly as provided. No modifications, no summaries.
