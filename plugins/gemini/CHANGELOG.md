# Changelog

## 1.0.0

Initial release.

- `/gemini:review` for standard code review
- `/gemini:adversarial-review` for steerable challenge review
- `/gemini:rescue` for task delegation via subagent
- `/gemini:status`, `/gemini:result`, `/gemini:cancel` for job management
- `/gemini:setup` for installation and authentication check
- `gemini:gemini-rescue` subagent for proactive task delegation
- Stop-time review gate (optional, via `/gemini:setup --enable-review-gate`)
- Background job support with detached workers
- Session resume support via Gemini CLI session IDs
