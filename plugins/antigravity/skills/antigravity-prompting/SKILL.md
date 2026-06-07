---
description: Internal guidance for composing effective prompts for Antigravity models when constructing task, review, and research prompts within the plugin.
---

# Antigravity Prompt Composition

Use structured blocks to compose prompts for Antigravity models. Follow these principles:

1. **State the task clearly** in a `<task>` block.
2. **Define the output contract** explicitly so the model knows the expected format.
3. **Add verification rules** for risky tasks.
4. **Use consistent tagging** across all prompts.

## Block types

See `references/prompt-blocks.md` for the full block catalog.
See `references/prompt-recipes.md` for task-specific templates.

## Key principles

- One job per prompt. Don't mix review, fix, docs, and roadmap.
- Ground every claim in provided context or tool outputs.
- If a point is an inference, label it clearly.
- Default to continuation: keep going until the task is complete.
- Verify before finalizing: check that the answer matches evidence and requirements.
