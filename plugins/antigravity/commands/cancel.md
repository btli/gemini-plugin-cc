---
description: Cancel an active background Gemini job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" cancel $ARGUMENTS`
