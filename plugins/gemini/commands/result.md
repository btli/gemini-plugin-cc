---
description: Show the final stored Gemini output for a finished job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" result $ARGUMENTS`

Present the complete, unmodified command output to the user, including:
- Job identification
- Status information
- The full result payload without condensation
- Any file references with exact line numbers
- Any errors encountered
- Suggested follow-up commands like `/gemini:status` and `/gemini:review`
- Gemini session ID for resuming in Gemini CLI with `gemini --resume <session-id>`

Do not summarize or condense the findings.
