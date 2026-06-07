---
description: Check whether the local Antigravity CLI (agy) is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" setup --json $ARGUMENTS
```

Output rules:
- Present the final setup output to the user.
- If agy is missing, tell the user to install Antigravity (https://antigravity.google), which bundles the `agy` CLI, then rerun `/antigravity:setup`.
- If agy is installed but not authenticated, tell the user to run `agy` interactively once, complete the Google sign-in, then rerun `/antigravity:setup`.
- Do not attempt to install or authenticate on the user's behalf.
