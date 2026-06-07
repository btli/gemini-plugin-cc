---
description: Show the final stored Antigravity output for a finished job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" result $ARGUMENTS`

Present the complete, unmodified command output to the user, including:
- Job identification
- Status information
- The full result payload without condensation
- Any file references with exact line numbers
- Any errors encountered
- Suggested follow-up commands like `/antigravity:status` and `/antigravity:review`
- agy conversation ID for resuming in the Antigravity CLI with `agy --conversation <conversation-id>`

Do not summarize or condense the findings.
