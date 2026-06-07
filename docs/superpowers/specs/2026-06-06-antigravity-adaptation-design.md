# Antigravity Plugin — Adaptation from Gemini CLI (ACP) to agy

**Date:** 2026-06-06
**Status:** Approved
**Plugin version:** 2.0.0 (breaking: command namespace + execution backend)

## Context

Google is deprecating the Gemini CLI in favor of Antigravity and its CLI, `agy`.
This plugin currently drives `gemini --acp` over JSON-RPC 2.0 (stdin/stdout) for
code reviews and task delegation from Claude Code. `agy` does not implement ACP,
so the transport layer must be replaced. Everything above the transport
(job tracking, background workers, git context collection, rendering, commands,
hooks) is transport-agnostic and survives with renames only.

## Verified agy behavior (live-probed, agy 1.0.6)

These facts were established by running `agy` directly; they are design inputs,
not assumptions:

1. **Print mode**: `agy --print "<prompt>"` runs one prompt non-interactively,
   prints the final response to stdout, exits 0 on success. `--print-timeout`
   bounds the run (default 5m).
2. **Stdin prompt delivery**: `echo "<prompt>" | agy --print ""` (and
   `--print -`) reads the prompt from stdin. Removes ARG_MAX concerns for large
   embedded review contexts (file cap 24 KB × 20 files + diff).
3. **Conversation resume**: `--conversation <uuid>` resumes a prior
   conversation in print mode with context intact. `--continue` resumes the
   most recent (not used — racy with concurrent jobs).
4. **Conversation ID capture**: agy's glog (redirectable per-run via
   `--log-file <path>`) contains `Print mode: conversation=<uuid>`.
   Conversation state lives in
   `~/.gemini/antigravity-cli/conversations/<uuid>.db`.
5. **Model flag accepts display labels only**: `--model "Gemini 3.1 Pro (High)"`
   resolves; slug forms (`gemini-3.1-pro`, `gemini-3.1-pro-high`) are **not
   recognized** and silently fall back to agy's default
   ("Gemini 3.5 Flash (Medium)"). The log records both the failure
   (`Failed to resolve model flag ...`) and the effective model
   (`Propagating selected model override to backend: label="..."`).
6. **No read-only enforcement**: print mode auto-approves file writes even
   without `--dangerously-skip-permissions`; `--sandbox` (terminal
   restrictions) does not block file writes either.
7. **Auth**: agy silent-auths from `~/.gemini` state (`oauth_creds.json` /
   `google_accounts.json`) shared with the old Gemini CLI; no OAuth prompt
   needed when those exist. First-time users sign in by running `agy`
   interactively.
8. **Available models** (`agy models`): Gemini 3.5 Flash (Low/Medium/High),
   Gemini 3.1 Pro (Low/High), Claude Sonnet 4.6 (Thinking),
   Claude Opus 4.6 (Thinking), GPT-OSS 120B (Medium).

## Goals

- Replace the ACP transport with an `agy` print-mode subprocess layer.
- Full rebrand: plugin name `antigravity`, commands `/antigravity:*`.
- Preserve all user-facing workflows: setup, review, adversarial-review, task
  delegation, status, result, cancel, rescue, resume-last, review gate.
- Keep the facade result shapes so job-control/state/render are untouched
  beyond renames.
- Enforce review isolation despite agy lacking a read-only mode
  (git-worktree strategy).
- Detect silent model fallback and fail loudly instead of reviewing with the
  wrong model.

## Non-goals

- Real-time streaming progress parsed from agy's internal log (job log already
  captures stdout; revisit if agy grows a stable structured output mode).
- Dual-backend support (gemini ACP fallback). The gemini implementation
  remains available in git history.
- MCP server wiring into agy conversations.
- Windows-specific cancellation paths beyond the existing
  `terminateProcessTree` fallback.

## Architecture

### Identity & file layout

| Current | New |
|---|---|
| `plugins/gemini/` | `plugins/antigravity/` |
| plugin name `gemini` (`/gemini:*`) | `antigravity` (`/antigravity:*`) |
| `scripts/gemini-companion.mjs` | `scripts/antigravity-companion.mjs` |
| `scripts/lib/gemini.mjs` | `scripts/lib/antigravity.mjs` |
| `scripts/lib/acp-client.mjs` | deleted |
| `scripts/lib/acp-lifecycle.mjs` | deleted |
| `scripts/lib/acp-protocol.d.ts` | deleted |
| — | `scripts/lib/agy-cli.mjs` (new) |
| — | `scripts/lib/review-worktree.mjs` (new) |
| `skills/gemini-cli-runtime/` | `skills/antigravity-cli-runtime/` |
| `skills/gemini-prompting/` | `skills/antigravity-prompting/` |
| `skills/gemini-result-handling/` | `skills/antigravity-result-handling/` |
| `agents/gemini-rescue.md` | `agents/antigravity-rescue.md` |
| `tests/acp-client.test.mjs` | deleted |
| `tests/acp-lifecycle.test.mjs` | deleted |
| `tests/acp-security.test.mjs` | deleted (worktree isolation replaces path-containment handlers) |
| `tests/fake-gemini-fixture.mjs` | `tests/fake-agy-fixture.mjs` |
| — | `tests/agy-cli.test.mjs`, `tests/review-worktree.test.mjs` (new) |

Command files keep their names (`review.md`, `setup.md`, …) — the namespace
comes from the plugin name. Their content (command references, model alias
docs, "Gemini" wording, install/auth instructions) is updated.

Docs: `GEMINI.md` content folds into `AGENTS.md`; `README.md`, `CLAUDE.md`,
`plugins/antigravity/CHANGELOG.md` (new 2.0.0 entry), root `package.json`
name, `.claude-plugin/marketplace.json` (name `antigravity`, source
`./plugins/antigravity`, version 2.0.0) all updated. Renaming the GitHub repo
to `antigravity-plugin-cc` is a manual follow-up noted in the PR description.

Hook scripts (`session-lifecycle-hook.mjs`, `stop-review-gate-hook.mjs`) keep
their `${CLAUDE_PLUGIN_ROOT}`-relative wiring (rename-safe) with message
strings and command references updated.

### Execution layer — `lib/agy-cli.mjs`

Single subprocess primitive replacing the ACP client + lifecycle:

```
runAgyPrint({
  prompt,             // string, written to stdin
  modelLabel,         // resolved display label, always passed
  conversationId,     // optional — adds --conversation <id>
  cwd,                // agy working directory (workspace or worktree)
  agyLogFile,         // per-job glog path, passed as --log-file
  timeoutMs,          // default 15 min
  skipPermissions,    // adds --dangerously-skip-permissions (write tasks only)
  env, binary = "agy"
}) → {
  ok, exitCode, stdout, stderr,
  conversationId,       // parsed from agy log; null if not found
  resolvedModelLabel,   // parsed from agy log; null if not found
  modelFellBack,        // true when resolvedModelLabel ≠ requested modelLabel
  timedOut
}
```

Mechanics:

- Spawn args: `--print "" --print-timeout <ceil(timeoutMs/1000)>s
  --model <modelLabel> --log-file <agyLogFile>` plus optional
  `--conversation` / `--dangerously-skip-permissions`. Prompt written to
  stdin, then stdin closed.
- `agyLogFile` convention: `<jobLogFile>.agy.log`, sibling of the existing job
  log so `/status`'s log plumbing is unchanged.
- After exit (or kill), parse the agy log for
  `Print mode: conversation=<uuid>` and the **last**
  `Propagating selected model override to backend: label="<label>"`.
- Node-side watchdog at `timeoutMs + 30s` SIGTERMs agy if its own
  `--print-timeout` fails to fire (hang protection). `timedOut: true` set by
  whichever path triggers.
- Cancellation: module tracks the active child; `installShutdownHandler`
  (kept in the facade) SIGTERMs it on worker SIGTERM/SIGINT — agy performs its
  own graceful conversation cleanup ("Cancelling conversation …"). The
  existing `/cancel` chain (SIGTERM worker PID → 3s grace →
  `terminateProcessTree`) is unchanged.

### Facade — `lib/antigravity.mjs`

Same exported surface as `lib/gemini.mjs` today, renamed:

- `runAntigravityTask(cwd, options)` →
  `{ ok, rawOutput, sessionId, stopReason, failureMessage }`
  - `sessionId` now carries the agy conversation UUID (same field name keeps
    `state`, `job-control`, `findLatestTaskSession`, `--resume-last`
    untouched).
  - `stopReason`: `"end_turn"` when exit 0, `"timeout"` when timed out,
    `"error"` otherwise.
  - On `modelFellBack`: result fails with
    `Model "<requested>" was not recognized; agy fell back to
    "<resolvedModelLabel>". Try: --model <alternative>` (replaces the old
    `buildModelFailureResult` path). Rate-limit detection
    (`429|RESOURCE_EXHAUSTED|capacity|rate.limit` on stderr + log tail) kept.
  - Partial output: stdout captured so far is returned on timeout/cancel.
- `runAntigravityReview(cwd, options)` — wraps task with worktree isolation
  (below), `parseStructuredOutput` (3-strategy JSON extraction, unchanged),
  same `{ ok, parsed, parseError, rawOutput, sessionId, reasoningSummary }`.
- `getAntigravityAvailability(cwd)` — `binaryAvailable("agy", ["--version"])`.
- `getAntigravityAuthStatus()` — `~/.gemini/oauth_creds.json` or
  `~/.gemini/google_accounts.json` present → authenticated; else
  `not authenticated. Run: agy (interactive) and complete sign-in`.
  `GEMINI_API_KEY`/`GOOGLE_API_KEY` checks dropped (agy is account-based).
- Kept as-is: `parseStructuredOutput`, `readOutputSchema`,
  `findLatestTaskSession`; `installShutdownHandler` now SIGTERMs the active
  agy child instead of sending `session/cancel`.
- Deleted (ACP-specific): `extractTextFromContent`, `extractResultText`,
  `interruptSession`.
- Setup next-steps: "Install the Antigravity CLI (`agy`) — bundled with
  Antigravity: https://antigravity.google" when missing; "Run `agy`
  interactively once and complete sign-in" when unauthenticated.

### Models — `lib/models.mjs`

Model IDs are agy display labels:

| Alias | Label |
|---|---|
| `pro` (DEFAULT) | `Gemini 3.1 Pro (High)` |
| `pro-low` | `Gemini 3.1 Pro (Low)` |
| `flash` | `Gemini 3.5 Flash (High)` |
| `flash-medium` | `Gemini 3.5 Flash (Medium)` |
| `flash-low` | `Gemini 3.5 Flash (Low)` |
| `sonnet` | `Claude Sonnet 4.6 (Thinking)` |
| `opus` | `Claude Opus 4.6 (Thinking)` |
| `gpt-oss` | `GPT-OSS 120B (Medium)` |

- `resolveModel(input)`: alias hit → label; otherwise pass through verbatim
  (agy supports custom models defined in user settings). Case-insensitive
  alias matching, as today.
- `DEFAULT_MODEL` = `Gemini 3.1 Pro (High)`, always passed explicitly
  (agy's own default is Flash Medium, not ours).
- `suggestAlternatives(failedLabel)` unchanged in spirit: aliases excluding
  the failed one.
- Typos in raw labels are caught post-run by `modelFellBack` (pre-spawn
  rejection is impossible without breaking custom models).

### Review isolation — `lib/review-worktree.mjs`

agy has no read-only mode, so reviews run in a disposable git worktree:

1. **Create**: `git worktree add --detach <os.tmpdir()>/agy-review-<jobId> HEAD`.
2. **Mirror working state** (best-effort, so the model reads files exactly as
   reviewed): `git diff HEAD --binary` applied inside the worktree, then copy
   untracked non-ignored files (`git ls-files --others --exclude-standard`).
   Mirror failures (e.g., unappliable patch) log a warning into the job log
   and proceed — review context is already embedded in the prompt.
3. **Run**: agy `cwd` = worktree path; job state stays keyed to the real
   `workspaceRoot` (facade already takes `cwd` and `workspaceRoot`
   separately). Stray writes land in the worktree; agy's workspace boundary
   (`BLOCK_REASON_OUTSIDE_WORKSPACE`) blocks paths outside it. Reviews do NOT
   pass `--dangerously-skip-permissions`.
4. **Cleanup**: `git worktree remove --force` in a `finally` block and in the
   SIGTERM path. Worktree absolute path is string-replaced out of
   `rawOutput`/rendered text so findings reference repo-relative paths.
5. **Orphan sweep**: at review start, list `git worktree list --porcelain`
   entries matching the `agy-review-*` naming pattern whose directory mtime is
   older than 24 h and remove them (covers SIGKILLed workers), then
   `git worktree prune`.
6. **Degrade**: if worktree creation fails, fall back to running in a plain
   temp directory (review context is self-contained in the prompt) and append
   a notice to the review result that repo file access was unavailable.

Exports: `createReviewWorktree(workspaceRoot, id)` → `{ path, cleanup() }`
(`id` = job ID for background reviews, random hex for foreground ones) and
`sweepOrphanedWorktrees(workspaceRoot)`. Worktree creation lives inside
`runAntigravityReview` so foreground and background reviews are isolated
identically.

### Tasks

- **Write tasks** (default): `cwd` = workspace, `--dangerously-skip-permissions`
  passed (matches the old ACP `approved: true` autonomous behavior; without it
  some tool classes may stall in print mode).
- **Read-only tasks** (`--read-only`): `cwd` = workspace (the model may need
  to read arbitrary repo files; prompt is not pre-packed), no skip flag, a
  read-only guard line prepended to the prompt, and a
  `git status --porcelain` snapshot before/after — any delta prepends a
  prominent warning to the result listing files the model touched.
  This is detection, not prevention; documented as a known limitation.

### Errors

- Pre-spawn failures (binary missing, worktree creation, bad args) return the
  standard failure-result shape; workers never throw across the process
  boundary.
- agy exit ≠ 0 → `failureMessage` from stderr tail (first 500 chars); the
  same rate-limit/auth regexes also scan the agy log tail (last 4 KB) since
  glog captures errors that never reach stderr. stdout-so-far preserved as
  partial output.
- Auth failure heuristics: stderr/log matching
  `not logged in|sign in|authentication failed` → failure message points to
  interactive `agy` sign-in.
- Timeouts return partial stdout with `stopReason: "timeout"`.

## Testing

`node --test tests/*.test.mjs` remains the only gate (no build step).

- **`tests/fake-agy-fixture.mjs`**: executable Node script standing in for the
  `agy` binary. Reads argv + stdin; honors `--log-file` by writing realistic
  glog lines (`Print mode: conversation=<uuid>`, `Propagating selected model
  override to backend: label="..."`); emits canned stdout; configurable exit
  code, delay, fallback-label behavior via env vars. `runAgyPrint` takes a
  `binary` override so tests point at the fixture.
- **`tests/agy-cli.test.mjs`**: stdin prompt delivery, arg construction
  (model/conversation/skip-permissions/print-timeout), conversation ID parse,
  model-fallback detection, exit-code mapping, watchdog timeout kill, partial
  stdout on kill.
- **`tests/review-worktree.test.mjs`**: against a scratch git repo —
  create/detach, dirty-state mirroring (modified + untracked files), cleanup,
  orphan sweep age logic, degrade path when not a git repo.
- **Updated**: `models.test.mjs` (labels/aliases/default),
  `runtime.test.mjs` + `commands.test.mjs` (renames, setup report fields),
  `render.test.mjs` (worktree path stripping), `extract-result-text.test.mjs`
  deleted with its ACP-only helpers.
- **Unchanged** beyond renames: `git.test.mjs`, `state.test.mjs`,
  `process.test.mjs`.

## Known limitations (documented in README)

- Read-only **tasks** rely on prompt guidance + post-hoc detection; only
  reviews get hard isolation.
- Review worktrees do not initialize submodules; submodule content is absent
  from the worktree (diff context still covers it).
- No streaming progress: `/antigravity:status` shows the job log (worker
  lifecycle + final output), not token-level streaming.
- agy must be signed in via one interactive run before background jobs work.

## Migration notes

- Job state root is `$CLAUDE_PLUGIN_DATA` (changes automatically with the
  plugin's identity) with fallback `$TMPDIR/gemini-companion/` →
  renamed `$TMPDIR/antigravity-companion/`. Old gemini job state is not
  migrated; new jobs start fresh.
- Users with `/gemini:*` muscle memory: README maps old → new commands.
