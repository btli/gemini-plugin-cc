# Follow-up Issues

Findings from Gemini adversarial review and Claude Opus code review that need proper implementation, not quick patches.

## Completed

### 1. Fix `interruptSession` — IPC-based cancellation
**Source:** Gemini adversarial review (critical)

**Fix:** Workers now call `installShutdownHandler()` at startup, which traps SIGTERM and sends `session/cancel` on the active ACP connection. `interruptSession` is a no-op kept for backward compatibility. `handleCancel` relies on `terminateProcessTree(pid)` to deliver SIGTERM to the worker.

**Files:** `gemini.mjs` (installShutdownHandler, _activeTask tracking), `gemini-companion.mjs` (worker functions)

### 2. Add timeouts to session setup requests
**Source:** Gemini adversarial review (high)

**Fix:** All ACP setup requests (`session/new`, `session/set_mode`, `session/set_model`, `session/load`, `initialize`) now use a shared `withTimeout()` helper with a 10s timeout in `acp-lifecycle.mjs`.

**Files:** `acp-lifecycle.mjs`

### 3. Add file size limit to `fs/read_text_file` handler
**Source:** Gemini adversarial review (medium)

**Fix:** Added `fs.stat` check before reading. Files over 5MB are rejected with a descriptive error.

**Files:** `acp-lifecycle.mjs` (installDefaultHandlers)

### 4. Return partial output on task failure
**Source:** Gemini adversarial review (medium)

**Fix:** Catch blocks in `runGeminiTask` now return `rawOutput: chunks.join("")` instead of `rawOutput: ""`. `buildModelFailureResult` accepts an optional `partialOutput` parameter.

**Files:** `gemini.mjs` (runGeminiTask catch blocks, buildModelFailureResult)

### 5. Buffer chunk logging
**Source:** Gemini adversarial review (low), Opus efficiency review

**Fix:** Added `createBufferedLogWriter()` in `tracked-jobs.mjs` that accumulates text and flushes on newlines. Streaming chunks use the buffered writer; tool_call events and turn completion trigger explicit flushes.

**Files:** `gemini.mjs` (notification handler), `tracked-jobs.mjs` (createBufferedLogWriter)
