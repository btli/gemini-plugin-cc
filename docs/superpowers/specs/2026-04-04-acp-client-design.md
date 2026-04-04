# ACP Client Integration Design

**Date:** 2026-04-04
**Status:** Approved
**Goal:** Replace blocking `spawnSync` Gemini CLI integration with async ACP (Agent Communication Protocol) client, aligned with Codex plugin architecture for maintainability.

## Context

The plugin currently invokes `gemini` CLI via `spawnSync` with flags (`-p`, `-o json`, `--approval-mode`). This blocks with no progress feedback and has no session management. Both the Codex plugin (`codex app-server` JSON-RPC) and abiswas97's gemini-plugin-cc (`gemini --acp` JSON-RPC) use bidirectional async protocols that provide streaming progress, graceful cancellation, and session resume.

Our goal is Codex alignment: when Codex ships protocol updates (new notification types, turn capture improvements), we want those changes to map cleanly onto our code with minimal adapter work.

## Architecture: Layered Client

Four layers, each with a clear Codex counterpart:

| Layer | File | Codex Equivalent |
|---|---|---|
| 1. Generic JSON-RPC | `acp-client.mjs` (`JsonRpcClient`) | `app-server.mjs` (`AppServerClientBase`) |
| 2. Gemini ACP transport | `acp-client.mjs` (`GeminiAcpClient`) | `app-server.mjs` (`SpawnedCodexAppServerClient`) |
| 3. Session orchestration | `acp-lifecycle.mjs` | `codex.mjs` (`withAppServer`, `startThread`, `resumeThread`) |
| 4. Task/review logic | `gemini.mjs` (rewritten) | `codex.mjs` (`runAppServerReview`, `runAppServerTurn`) |

### Why not a single class?

Codex separates the JSON-RPC protocol from the transport (`AppServerClientBase` vs `SpawnedCodexAppServerClient` vs `BrokerCodexAppServerClient`). We follow the same pattern: `JsonRpcClient` knows nothing about Gemini, `GeminiAcpClient` handles the subprocess. If Gemini ever gets a broker/shared runtime, we add a second transport subclass without touching the protocol layer.

---

## File Changes

### New Files

#### `scripts/lib/acp-client.mjs`

Two classes in one file:

**`JsonRpcClient`** (base) — Generic JSON-RPC 2.0 over newline-delimited JSON:

```
Fields:
  pending          Map<id, {resolve, reject, method}>
  nextId           number (monotonic counter)
  notificationHandler  function|null (single, replaceable — Codex pattern)
  serverRequestHandlers  Map<method, asyncFn> (per-method registry)
  closed           boolean
  exitError        Error|null
  lineBuffer       string
  exitPromise      Promise (resolves when connection ends)

Methods:
  setNotificationHandler(handler)
    Single replaceable handler. Matches Codex's API so captureTurn can be ported later.

  onServerRequest(method, handler)
    Per-method async handler registry. Needed because Gemini ACP sends
    fs/read_text_file, fs/write_text_file, session/request_permission.
    Unknown methods get -32601 reject (Codex default).

  request(method, params) → Promise
    Assigns ID, tracks in pending Map, sends JSON-RPC request.
    Rejects if closed.

  notify(method, params)
    Fire-and-forget (no ID). Used for session/cancel.

  handleChunk(chunk)
    Buffers incoming data, splits on \n, feeds to handleLine.

  handleLine(line)
    Parses JSON, dispatches:
    - id + method → server request (handleServerRequest)
    - id only → response (resolve/reject from pending Map)
    - method only → notification (notificationHandler)

  handleServerRequest(message)
    Looks up serverRequestHandlers Map.
    If found: call async handler, send result.
    If not found: send -32601 error.

  handleExit(error)
    Sets closed, rejects all pending promises, resolves exitPromise.

  sendMessage(message)
    Abstract — subclass implements.
```

**`GeminiAcpClient extends JsonRpcClient`** — Gemini subprocess transport:

```
Fields:
  proc       ChildProcess
  rl         readline.Interface
  stderr     string (accumulated)

Constructor(proc):
  - Wire readline on proc.stdout → handleLine
  - Collect proc.stderr
  - proc.on("exit") → handleExit
  - proc.on("error") → handleExit

sendMessage(message):
  JSON.stringify(message) + "\n" to proc.stdin

close(opts = {}):
  Graceful 3-phase shutdown:
  1. stdin.end(), readline.close()
  2. After phase1Ms (default 100): SIGTERM
  3. After phase2Ms (default 1500): SIGKILL
  proc.once("exit") short-circuits at each phase.
  Mirrors abiswas97's shutdown + Codex's close pattern.

Properties:
  pid → proc.pid
  exited → closed
```

#### `scripts/lib/acp-lifecycle.mjs`

Session lifecycle orchestration:

```
detectAcpFlag(binary = "gemini") → "--acp" | "--experimental-acp"
  Runs gemini --version (sync, via existing runCommand).
  Parses semver: >=0.33.0 → "--acp", older → "--experimental-acp".
  Caches per binary. clearFlagCache() for tests.

installDefaultHandlers(client, opts = {})
  Registers server request handlers with workspace-scoped path sandboxing:
  - fs/read_text_file → resolves path against opts.workspaceRoot, rejects
    absolute paths, paths escaping the root (../ traversal), and symlinks
    outside the workspace. Reads file only if contained within workspace.
  - fs/write_text_file → ONLY registered when opts.write is true.
    Same path sandboxing as read. When write is false, handler is not
    registered at all (request gets -32601 reject from base class).
    Even when registered, the handler itself enforces workspace containment
    as a defense-in-depth measure.
  - session/request_permission → approved only when opts.write is true,
    denied otherwise.
  Optionally logs all handler invocations to opts.logFile via appendLogLine.

spawnAcpClient(opts = {}) → Promise<GeminiAcpClient>
  opts: { binary, cwd, env }
  1. detectAcpFlag(binary)
  2. spawn(binary, [flag], { stdio: ["pipe","pipe","pipe"] })
  3. new GeminiAcpClient(proc)
  4. installDefaultHandlers(client, opts)
  5. client.request("initialize", { protocolVersion: 1, clientInfo, clientCapabilities })
     with 10s timeout (Promise.race)
  6. Return connected client

createSession(opts = {}) → Promise<{ client, sessionId }>
  opts: { binary, cwd, env, modeId, model, write, logFile }
  1. spawnAcpClient(opts)
  2. client.request("session/new", { cwd })
  3. client.request("session/set_mode", { sessionId, modeId })
  4. If model: client.request("session/set_model", { sessionId, modelId })
  5. Override permission handler based on opts.write
  6. Return { client, sessionId }

resumeSession(sessionId, opts = {}) → Promise<{ client, sessionId }>
  1. spawnAcpClient(opts)
  2. client.request("session/load", { sessionId, cwd })
  3. Return { client, sessionId }

isAlive(client) → boolean
  client.exited check + process.kill(pid, 0)

withAcpClient(cwd, fn) → Promise<result>
  Creates client, calls fn(client), closes client.
  Error cleanup guaranteed via try/finally.
  Mirrors Codex's withAppServer (without broker retry — not applicable).
```

#### `scripts/lib/models.mjs`

Extracted from gemini.mjs (currently inline):

```
MODELS           frozen object of known model IDs
DEFAULT_MODEL    default model ID
MODEL_ALIASES    Map of shorthand → full model ID
resolveModel(input) → model ID (alias resolution + passthrough)
suggestAlternatives(failedModel) → string[] (for rate-limit fallback)
```

Aliases: flash, pro, flash-lite (current), plus flash-3, pro-3 (abiswas97's additions). `normalizeRequestedModel` from current gemini.mjs becomes `resolveModel` here.

#### `scripts/lib/acp-protocol.d.ts`

TypeScript type definitions for IDE support. Not required at runtime. Covers:
- JsonRpcRequest, JsonRpcNotification, JsonRpcResponse
- NewSessionParams/Result, LoadSessionParams
- PromptParams/Result, CancelParams
- SetModeParams, SetModelParams
- SessionUpdateParams (notification)
- RequestPermissionParams/Result
- ReadTextFileParams/Result, WriteTextFileParams

---

### Modified Files

#### `scripts/lib/gemini.mjs` — Rewritten

**Removed:**
- `runGeminiSync()` — replaced by ACP client
- `parseJsonOutput()` — ACP gives chunks directly
- `buildGeminiArgs()` — ACP uses method params
- `cleanGeminiStderr()` — not needed
- `spawnGeminiBackground()` — replaced by ACP
- `normalizeRequestedModel()` — moved to models.mjs
- `MODEL_ALIASES` — moved to models.mjs

**Kept as-is:**
- `parseStructuredOutput(rawText)` — review JSON extraction (3-strategy: direct, markdown fence, brace extraction)
- `readOutputSchema(schemaPath)` — schema loading
- `findLatestTaskSession(workspaceRoot, listJobs)` — queries state, no Gemini interaction

**Rewritten (sync → async):**

`runGeminiTask(cwd, opts) → Promise`:
- opts: `{ prompt, model, write, resume, logFile, onProgress, env }`
- Creates or resumes session via `createSession`/`resumeSession`
- **Immediately persists sessionId** to job state via `upsertJob` if a jobId
  is provided in opts. This enables graceful cancel of in-flight background
  jobs (fixes the gap where sessionId was only persisted at completion).
- Installs notification handler to collect `session/update` events:
  - `agent_message_chunk` → append to chunks array, call onProgress
  - `tool_call` → call onProgress with tool name
- Sends prompt via `client.prompt(sessionId, [{type:"text", text:prompt}])`
- Handles rate-limit errors (429/RESOURCE_EXHAUSTED) → structured error with `suggestAlternatives`
- Handles malformed output → structured error
- Shuts down client
- **Returns same shape as today:** `{ ok, rawOutput, sessionId, stopReason, failureMessage }`
  - `rawOutput` = chunks.join("") (was: result.stdout)
  - `sessionId` from createSession (was: parsed from JSON output)

`runGeminiReview(cwd, opts) → Promise`:
- opts: `{ prompt, model, timeoutMs, logFile, onProgress, env }`
- Calls `runGeminiTask` with `modeId: "plan"` (read-only, matches current `approvalMode: "plan"`)
- Parses response through `parseStructuredOutput` (unchanged)
- **Returns same shape as today:** `{ ok, parsed, parseError, rawOutput, sessionId, reasoningSummary }`

`interruptSession(sessionId, opts) → Promise`:
- Spawns fresh short-lived ACP client via `spawnAcpClient`
- Sends `client.notify("session/cancel", { sessionId })`
- Waits 200ms, then `client.close()`
- Used by cancel command for graceful cancellation before process tree kill fallback

**Return shape compatibility is critical.** `renderReviewResult`, `renderTaskResult`, `renderStoredJobResult`, and all job-control functions consume these shapes. Keeping them identical means render.mjs, job-control.mjs, state.mjs, and tracked-jobs.mjs are untouched.

#### `scripts/gemini-companion.mjs` — Async Wrapping

Minimal changes:

```js
// Before:
function main() {
  const [command, ...argv] = process.argv.slice(2);
  switch (command) {
    case "review": handleReview(cwd, argv); break;
    ...
  }
}
main();

// After:
async function main() {
  const [command, ...argv] = process.argv.slice(2);
  switch (command) {
    case "review": await handleReview(cwd, argv); break;
    ...
  }
}
main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
```

Handler functions that call gemini.mjs become async:
- `handleReview` → async (calls `runGeminiReview`)
- `executeReviewForeground` → async
- `handleReviewWorker` → async
- `handleTask` → async (calls `runGeminiTask`)
- `executeTask` → async
- `handleTaskWorker` → async
- `handleCancel` → async (calls `interruptSession` before process tree kill)

Handler functions that don't touch Gemini stay sync:
- `handleSetup` — only checks availability/auth (sync process.mjs calls)
- `handleStatus` — reads state files
- `handleResult` — reads state files

`getGeminiAvailability` and `getGeminiAuthStatus` stay sync (they use `spawnSync` to check `--version` and credential files). This is correct — Codex does the same for its availability check.

---

### Untouched Files

These files require zero changes:

| File | Reason |
|---|---|
| `state.mjs` | Reads/writes JSON state files, no Gemini interaction |
| `job-control.mjs` | Queries state, enriches jobs, no Gemini interaction |
| `render.mjs` | Consumes result shapes (unchanged), pure formatting |
| `git.mjs` | Git operations, no Gemini interaction |
| `process.mjs` | Generic process utilities. `terminateProcessTree` still used as fallback in cancel |
| `tracked-jobs.mjs` | Job logging/progress. `appendLogLine` still called by ACP update handler |
| `args.mjs` | CLI argument parsing |
| `fs.mjs` | File utilities |
| `workspace.mjs` | Workspace root resolution |
| `prompts.mjs` | Template loading/interpolation |
| All `commands/*.md` | Slash command definitions (call gemini-companion.mjs, which handles the async internally) |
| All `hooks/` | Hook scripts invoke gemini-companion.mjs as a subprocess |
| All `skills/` | Skill definitions (no code changes needed) |
| `agents/gemini-rescue.md` | Agent definition |

---

## Testing Strategy

### Fake ACP Server

New file: `tests/fake-gemini-fixture.mjs`

Rewrites existing fixture to implement ACP protocol instead of CLI flags. Writes a self-contained Node.js script to disk as a fake `gemini` binary that:

1. Responds to `--version` with configurable semver (default `0.33.0`)
2. On `--acp` flag: enters JSON-RPC mode on stdio
3. Handles: `initialize`, `session/new`, `session/load`, `session/set_mode`, `session/set_model`, `session/prompt`, `session/cancel`, `session/list`
4. Emits `session/update` notifications during `session/prompt` (streaming chunks)
5. Persists state to JSON file (sessions, prompts, cancels) for test assertions

Configurable behaviors (matching abiswas97's patterns):
- `task-ok` — normal task completion with chunk streaming
- `review-ok` — returns valid review JSON
- `crash` — exits mid-prompt
- `hang` — never responds to prompt
- `permission` — sends permission request before completing
- `rate-limit` — returns 429-style error
- `session-load` — tests resume flow
- `write-in-readonly` — sends fs/write_text_file without prior permission (tests sandbox enforcement)
- `path-escape` — sends fs/read_text_file with `../../etc/passwd` (tests containment)

### New Test Files

| File | Tests |
|---|---|
| `tests/acp-client.test.mjs` | JsonRpcClient: request/response, notifications, server requests, exit handling, line buffering, **read-only write rejection**, **path escape rejection** |
| `tests/acp-lifecycle.test.mjs` | detectAcpFlag, spawnAcpClient handshake, createSession, resumeSession, isAlive, **workspace path sandboxing**, **write handler not registered in read-only mode** |
| `tests/models.test.mjs` | resolveModel aliases, suggestAlternatives |

### Modified Test Files

| File | Changes |
|---|---|
| `tests/runtime.test.mjs` | Update to use new fake fixture, test async review/task flows |
| `tests/commands.test.mjs` | Update to use new fake fixture |
| `tests/fake-gemini-fixture.mjs` | Rewritten: ACP protocol instead of CLI flag simulation |

### Unchanged Test Files

| File | Reason |
|---|---|
| `tests/git.test.mjs` | Tests git operations, no Gemini dependency |
| `tests/state.test.mjs` | Tests state persistence, no Gemini dependency |
| `tests/helpers.mjs` | Test utilities (makeTempDir, writeExecutable, initGitRepo) |

---

## Security: Filesystem Trust Boundary

The current `spawnSync` approach delegates all filesystem access to the Gemini CLI process, which runs with the user's full permissions. The ACP design moves filesystem operations into our process via server request handlers. This creates a new trust boundary that must be enforced.

**Workspace sandboxing rules for file RPC handlers:**

1. All paths received from Gemini are resolved against `workspaceRoot` (from `resolveWorkspaceRoot(cwd)`)
2. Absolute paths are rejected (must be relative to workspace)
3. Paths containing `..` segments that escape the workspace root are rejected after `path.resolve`
4. Symlinks are resolved via `fs.realpath` and checked against the workspace root
5. Read handler is always registered; write handler is **only registered when `write: true`**
6. Even when the write handler is registered, it enforces workspace containment as defense-in-depth
7. All handler invocations (accepted and rejected) are logged to the job log file

**Why this matters:** Without these checks, a model that sends `fs/write_text_file` with path `../../.ssh/authorized_keys` could write outside the workspace. The permission handler (`session/request_permission`) is not a reliable gate — it's a courtesy mechanism, not a security boundary.

---

## Error Handling

### Rate Limiting

Gemini returns rate-limit errors as ACP error responses (429/RESOURCE_EXHAUSTED). We detect these in `runGeminiTask` and throw structured errors with:
- `error.code = "RATE_LIMITED"`
- `error.model` = the model that was rate-limited
- `error.suggestions` = alternative models from `suggestAlternatives()`

This matches abiswas97's pattern and gives the render layer enough info to suggest fallback models.

### Malformed Output

Gemini occasionally returns malformed function calls. Detected by regex on error message, thrown as:
- `error.code = "MODEL_UNAVAILABLE"`
- `error.model` + `error.suggestions`

### Process Exit

If the Gemini ACP process exits unexpectedly mid-turn:
- `JsonRpcClient.handleExit()` rejects all pending promises
- `runGeminiTask` catches the rejection, returns `{ ok: false, failureMessage: ... }`
- Job state updated to "failed"

### Initialize Timeout

`spawnAcpClient` uses `Promise.race` with a 10s timeout on the initialize handshake. If Gemini CLI is unresponsive at startup, we fail fast with a clear error.

---

## Cancel Flow

Current: `terminateProcessTree(pid)` — abrupt SIGTERM.

New (3-step):
1. Look up the job's `sessionId` from state (now persisted immediately after session creation, not just at completion)
2. If sessionId exists: `interruptSession(sessionId)` — spawns fresh ACP client, sends `session/cancel` notification, gives Gemini 200ms to clean up
3. Falls back to `terminateProcessTree(pid)` if the process is still alive or sessionId was not yet persisted

This matches how Codex uses `turn/interrupt` before process kill. The early sessionId persistence ensures most in-flight jobs can be gracefully cancelled.

---

## Migration Path for Future Codex Features

### `captureTurn` State Machine

If we later need Codex's full turn capture (multi-thread, subagent tracking, inferred completion):
1. The `JsonRpcClient.setNotificationHandler` API is identical to Codex's
2. A `captureTurn(client, sessionId, startRequest, opts)` function would install a handler, start the request, collect notifications, and resolve on completion
3. The `JsonRpcClient` base class doesn't need changes — only the orchestration layer grows

### Broker/Shared Runtime

If Gemini adds a shared runtime (equivalent to Codex's broker):
1. Add `BrokerGeminiAcpClient extends JsonRpcClient` with socket transport
2. Add `GeminiAcpClient.connect()` static factory (try broker, fall back to spawn)
3. `acp-lifecycle.mjs` gets broker session management
4. Everything above the transport layer is unchanged

### New Notification Types

If Gemini ACP adds richer notifications (item/started, item/completed, etc.):
1. The notification handler already receives all notifications
2. We add handling in the task/review functions or in a future captureTurn equivalent
3. No protocol layer changes needed

---

## Summary of Changes

| Category | Files | Nature |
|---|---|---|
| **New** | `acp-client.mjs`, `acp-lifecycle.mjs`, `models.mjs`, `acp-protocol.d.ts` | Core ACP implementation |
| **Rewritten** | `gemini.mjs` | sync → async, ACP client instead of spawnSync |
| **Modified** | `gemini-companion.mjs` | handlers become async, top-level await |
| **Rewritten** | `tests/fake-gemini-fixture.mjs` | ACP protocol fixture |
| **New** | `tests/acp-client.test.mjs`, `tests/acp-lifecycle.test.mjs`, `tests/models.test.mjs` | New test coverage |
| **Modified** | `tests/runtime.test.mjs`, `tests/commands.test.mjs` | Updated for async + ACP fixture |
| **Untouched** | 13 source files, all commands/hooks/skills/agents | Zero changes |
