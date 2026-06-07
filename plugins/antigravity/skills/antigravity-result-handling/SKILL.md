---
description: Internal guidance for presenting Gemini helper output to the user. Covers review results, task output, and error handling.
---

# Gemini Result Handling

## Preservation rules

- Preserve the helper's verdict, summary, findings, and next steps structure.
- Keep review findings ordered by severity.
- Keep file paths and line numbers exact.
- Distinguish confirmed facts, inferences, and uncertainties as marked.

## Review safeguard

After presenting review findings, **STOP**. Do not make any code changes.
The user must explicitly approve which issues to address before any modifications.

## Error handling

- Report failed or incomplete Gemini runs without attempting Claude-side workarounds.
- Include actionable stderr output when setup or authentication issues arise.
- Direct users to `/gemini:setup` for authentication rather than improvising alternatives.

## Output rules

- Present requested sections: observed facts, open questions, touched files.
- State explicitly when no findings exist.
- List modified files when Gemini makes edits.
- When a Gemini session ID is available, include it so the user can resume with `gemini --resume <session-id>`.

## Overriding principle

Communicate Gemini's output faithfully, avoid auto-fixing, and obtain user consent before any code modifications.
