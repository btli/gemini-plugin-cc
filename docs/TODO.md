# Follow-up Issues

Findings from Gemini adversarial review and Claude Opus code review that need proper implementation, not quick patches.

## High Priority

### 1. Fix `interruptSession` — IPC-based cancellation
**Source:** Gemini adversarial review (critical)

`interruptSession` spawns a NEW gemini --acp process to send cancel — this doesn't work because without a shared broker, the new process has no knowledge of the original session. Need to implement proper IPC: the background worker should trap SIGTERM, send `session/cancel` on its own active ACP connection, and close gracefully.

**Files:** `gemini.mjs`, `gemini-companion.mjs` (worker functions)

### 2. Add timeouts to session setup requests
**Source:** Gemini adversarial review (high)

`session/new`, `session/set_mode`, `session/set_model`, `session/load` have no timeouts. If Gemini stalls during setup, the CLI hangs forever. Wrap in `Promise.race` with 10s timeout like the initialize handshake.

**Files:** `acp-lifecycle.mjs` (createSession, resumeSession)

### 3. Add file size limit to `fs/read_text_file` handler
**Source:** Gemini adversarial review (medium)

The read handler reads entire files into memory with no size limit. A request for a huge file causes OOM. Add `fs.stat` check before reading, reject files over 5MB.

**Files:** `acp-lifecycle.mjs` (installDefaultHandlers)

### 4. Return partial output on task failure
**Source:** Gemini adversarial review (medium)

When `session/prompt` rejects (timeout, rate limit, crash), the catch block returns `rawOutput: ""`, discarding the `chunks` array. Should return `rawOutput: chunks.join("")` to preserve partial output.

**Files:** `gemini.mjs` (runGeminiTask catch blocks, buildModelFailureResult)

### 5. Buffer chunk logging
**Source:** Gemini adversarial review (low), Opus efficiency review

`appendLogLine` (sync `fs.appendFileSync`) is called for every `agent_message_chunk`. This is sync I/O per streamed token batch. Buffer chunks and flush on newlines or turn completion.

**Files:** `gemini.mjs` (notification handler), possibly `tracked-jobs.mjs`
