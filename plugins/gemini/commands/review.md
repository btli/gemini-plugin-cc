---
description: Run a Gemini code review on your current work
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--wait] [--background]'
allowed-tools: Bash(node:*), AskUserQuestion
---

This command runs a code review through Gemini CLI.

Parse the user's arguments. Supported flags: `--base <ref>`, `--scope <auto|working-tree|branch>`, `--model <model>`, `--wait`, `--background`.

## Execution modes

**Foreground (`--wait`):**
Run immediately without confirmation:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review --wait $ARGUMENTS
```

Return the stdout verbatim. Do not paraphrase, summarize, or add commentary.

**Background (`--background`):**
Run without waiting:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review --background $ARGUMENTS
```

Tell the user the job was started and to check `/gemini:status` for progress.

**Default (no flag):**
Estimate the review scope by running:

```bash
git status --short --untracked-files=all
git diff --shortstat
```

If the output shows only 1-2 small files with minor changes, recommend foreground.
In every other case, including unclear size, recommend background.

Use `AskUserQuestion` to let the user pick foreground or background.

## Constraints

- This is review-only. Do not fix issues, apply patches, or suggest that you are about to make changes.
- This does not support staged-only review, unstaged-only review, or extra focus text. Use `/gemini:adversarial-review` when you want custom instructions.
- Present the Gemini output exactly as returned.
