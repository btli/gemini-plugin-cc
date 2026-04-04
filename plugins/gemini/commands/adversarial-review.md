---
description: Run a steerable adversarial Gemini review that challenges your implementation choices
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--wait] [--background] [focus text...]'
allowed-tools: Bash(node:*), AskUserQuestion
---

This command runs a challenge review through Gemini that questions the chosen implementation, design choices, tradeoffs, and assumptions.

Parse the user's arguments. Supported flags: `--base <ref>`, `--scope <auto|working-tree|branch>`, `--model <model>`, `--wait`, `--background`. Everything after the flags is focus text.

## Execution modes

**Foreground (`--wait`):**
Run immediately:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" adversarial-review --wait $ARGUMENTS
```

Return stdout verbatim. Do not paraphrase.

**Background (`--background`):**
Run without waiting:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" adversarial-review --background $ARGUMENTS
```

Tell the user the job was started and to check `/gemini:status`.

**Default:**
Estimate scope by checking git status and diff stats.
If small (1-2 files), run foreground. Otherwise recommend background.
Use `AskUserQuestion` to let the user choose.

## Constraints

- This is review-only. Do not fix issues, apply patches, or suggest that you are about to make changes.
- Present the Gemini output exactly as returned.
