---
description: Internal guidance for presenting Antigravity helper output to the user. Covers review results, task output, and error handling.
---

# Antigravity Result Handling

## Preservation rules

- Preserve the helper's verdict, summary, findings, and next steps structure.
- Keep review findings ordered by severity.
- Keep file paths and line numbers exact.
- Distinguish confirmed facts, inferences, and uncertainties as marked.

## Review safeguard

After presenting review findings, **STOP**. Do not make any code changes.
The user must explicitly approve which issues to address before any modifications.

## Error handling

- Report failed or incomplete Antigravity runs without attempting Claude-side workarounds.
- Include actionable stderr output when setup or authentication issues arise.
- Direct users to `/antigravity:setup` for authentication rather than improvising alternatives.

## Output rules

- Present requested sections: observed facts, open questions, touched files.
- State explicitly when no findings exist.
- List modified files when Antigravity makes edits.
- When an agy conversation ID is available, include it so the user can resume with `agy --conversation <conversation-id>`.

## Overriding principle

Communicate Antigravity's output faithfully, avoid auto-fixing, and obtain user consent before any code modifications.
