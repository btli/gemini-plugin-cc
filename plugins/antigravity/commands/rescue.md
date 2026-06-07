---
description: Hand a task to Gemini through the antigravity:antigravity-rescue subagent
argument-hint: '[--background] [--wait] [--model <model>] [--resume] [--fresh] [task description...]'
allowed-tools: Bash(node:*), Agent(antigravity:antigravity-rescue), AskUserQuestion
---

This command delegates work to Gemini through the `antigravity:antigravity-rescue` subagent.

Parse the user's arguments. Supported flags: `--background`, `--wait`, `--model <model>`, `--resume`, `--fresh`. Everything after the flags is the task description.

## Resume logic

Before launching the subagent, check whether a resumable Gemini session exists:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" status --json
```

If there is a recent task session and the user did not pass `--resume` or `--fresh`:
- Use `AskUserQuestion` to ask whether to continue the existing session or start fresh.
- If the user's text contains follow-up phrases like "continue", "keep going", "dig deeper", or "pick up where you left off", recommend resuming.

## Execution

Route the request to the `antigravity:antigravity-rescue` subagent. The subagent is a thin forwarder that invokes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" task <arguments>
```

Pass all flags and the task description through.

## Constraints

- You are a thin forwarder only. Do not inspect the repository, read files, or do independent work.
- Return the Gemini output exactly as returned by the subagent. Do not paraphrase or add commentary.
