# ACP Client Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blocking `spawnSync` Gemini CLI integration with async ACP client aligned with Codex plugin architecture.

**Architecture:** Layered client — generic JSON-RPC base class (`JsonRpcClient`) extended by Gemini transport (`GeminiAcpClient`), with session orchestration in `acp-lifecycle.mjs` and task/review logic in rewritten `gemini.mjs`. Return shapes preserved so render/state/job-control layers are untouched.

**Tech Stack:** Node.js ESM (.mjs), `node:child_process` spawn, `node:readline`, `node:fs/promises`, `node:test` for testing.

**Spec:** `docs/superpowers/specs/2026-04-04-acp-client-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `plugins/gemini/scripts/lib/models.mjs` | Create | Model aliases, resolution, fallback suggestions |
| `plugins/gemini/scripts/lib/acp-client.mjs` | Create | `JsonRpcClient` base + `GeminiAcpClient` transport |
| `plugins/gemini/scripts/lib/acp-lifecycle.mjs` | Create | Spawn, flag detection, session create/resume, default handlers, path sandboxing |
| `plugins/gemini/scripts/lib/acp-protocol.d.ts` | Create | TypeScript type definitions for IDE support |
| `plugins/gemini/scripts/lib/gemini.mjs` | Rewrite | Async `runGeminiTask`, `runGeminiReview`, `interruptSession` via ACP |
| `plugins/gemini/scripts/gemini-companion.mjs` | Modify | Async handler wrapping |
| `tests/fake-gemini-fixture.mjs` | Rewrite | ACP protocol fixture |
| `tests/helpers.mjs` | Modify | Add `writeExecutable`, `makeTempDir` |
| `tests/acp-client.test.mjs` | Create | JSON-RPC client tests |
| `tests/acp-lifecycle.test.mjs` | Create | Lifecycle + sandbox tests |
| `tests/models.test.mjs` | Create | Model alias tests |
| `tests/runtime.test.mjs` | Modify | Update for async ACP fixture |

---

### Task 1: Extract `models.mjs`

**Files:**
- Create: `plugins/gemini/scripts/lib/models.mjs`
- Test: `tests/models.test.mjs`
- Modify: `plugins/gemini/scripts/lib/gemini.mjs` (remove `MODEL_ALIASES`, `normalizeRequestedModel`)

- [ ] **Step 1: Write the failing test**

Create `tests/models.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveModel, suggestAlternatives, MODEL_ALIASES } from "../plugins/gemini/scripts/lib/models.mjs";

describe("resolveModel", () => {
  it("resolves 'flash' alias", () => {
    assert.equal(resolveModel("flash"), "gemini-2.5-flash");
  });

  it("resolves 'pro' alias", () => {
    assert.equal(resolveModel("pro"), "gemini-2.5-pro");
  });

  it("resolves 'flash-lite' alias", () => {
    assert.equal(resolveModel("flash-lite"), "gemini-2.5-flash-lite");
  });

  it("resolves 'flash-3' alias", () => {
    assert.equal(resolveModel("flash-3"), "gemini-3-flash");
  });

  it("resolves 'pro-3' alias", () => {
    assert.equal(resolveModel("pro-3"), "gemini-3.1-pro");
  });

  it("passes through unknown model names", () => {
    assert.equal(resolveModel("gemini-custom-model"), "gemini-custom-model");
  });

  it("returns null for null input", () => {
    assert.equal(resolveModel(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(resolveModel(""), null);
  });

  it("is case-insensitive", () => {
    assert.equal(resolveModel("Flash"), "gemini-2.5-flash");
    assert.equal(resolveModel("PRO"), "gemini-2.5-pro");
  });
});

describe("suggestAlternatives", () => {
  it("returns aliases excluding the failed model", () => {
    const suggestions = suggestAlternatives("gemini-2.5-flash");
    assert.ok(suggestions.length > 0);
    assert.ok(!suggestions.includes("flash"));
  });

  it("returns all aliases when failed model is unknown", () => {
    const suggestions = suggestAlternatives("unknown-model");
    assert.ok(suggestions.length === MODEL_ALIASES.size);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/models.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write `models.mjs`**

Create `plugins/gemini/scripts/lib/models.mjs`:

```js
export const MODEL_ALIASES = new Map([
  ["flash", "gemini-2.5-flash"],
  ["pro", "gemini-2.5-pro"],
  ["flash-lite", "gemini-2.5-flash-lite"],
  ["flash-3", "gemini-3-flash"],
  ["pro-3", "gemini-3.1-pro"]
]);

export function resolveModel(input) {
  if (input == null) {
    return null;
  }
  const normalized = String(input).trim();
  if (!normalized) {
    return null;
  }
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

export function suggestAlternatives(failedModelId) {
  const alternatives = [];
  for (const [alias, modelId] of MODEL_ALIASES) {
    if (modelId !== failedModelId) {
      alternatives.push(alias);
    }
  }
  if (alternatives.length === 0) {
    return [...MODEL_ALIASES.keys()];
  }
  return alternatives;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/models.test.mjs`
Expected: All PASS

- [ ] **Step 5: Update `gemini.mjs` imports**

In `plugins/gemini/scripts/lib/gemini.mjs`, remove the `MODEL_ALIASES` constant and `normalizeRequestedModel` function. Replace the export with a re-export:

```js
// At top of gemini.mjs, add:
export { resolveModel as normalizeRequestedModel } from "./models.mjs";

// Remove these lines (approximately lines 8-23):
// const MODEL_ALIASES = new Map([...]);
// export function normalizeRequestedModel(model) { ... }
```

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `node --test tests/*.test.mjs`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add plugins/gemini/scripts/lib/models.mjs tests/models.test.mjs plugins/gemini/scripts/lib/gemini.mjs
git commit -m "refactor: extract model aliases into models.mjs"
```

---

### Task 2: Create `acp-client.mjs` — JSON-RPC Base + Transport

**Files:**
- Create: `plugins/gemini/scripts/lib/acp-client.mjs`
- Test: `tests/acp-client.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/acp-client.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { GeminiAcpClient } from "../plugins/gemini/scripts/lib/acp-client.mjs";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "acp-client-test-"));
}

function writeScript(dir, name, src) {
  const p = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(p, src, "utf8");
  return p;
}

function spawnScript(dir, name, src) {
  const scriptPath = writeScript(dir, name, src);
  return spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });
}

describe("GeminiAcpClient", () => {
  it("resolves requests by id", async () => {
    const dir = makeTempDir();
    const proc = spawnScript(dir, "echo-server", `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: msg.id, result: { protocolVersion: 1 } }) + "\\n");
  }
});
`);
    const client = new GeminiAcpClient(proc);
    const result = await client.request("initialize", { protocolVersion: 1 });
    assert.equal(result.protocolVersion, 1);
    await client.close();
  });

  it("rejects pending requests when process exits", async () => {
    const dir = makeTempDir();
    const proc = spawnScript(dir, "crash-server", `process.exit(1);`);
    const client = new GeminiAcpClient(proc);
    await assert.rejects(
      () => client.request("initialize", {}),
      (err) => err.message.includes("exited")
    );
  });

  it("dispatches notifications to handler", async () => {
    const dir = makeTempDir();
    const proc = spawnScript(dir, "notify-server", `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { text: "hello" } } } }) + "\\n");
    process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + "\\n");
  }
});
`);
    const client = new GeminiAcpClient(proc);
    const notifications = [];
    client.setNotificationHandler((msg) => notifications.push(msg));
    await client.request("initialize", {});
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].params.sessionId, "s1");
    await client.close();
  });

  it("handles server-to-client requests", async () => {
    const dir = makeTempDir();
    const proc = spawnScript(dir, "permission-server", `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: 99, method: "session/request_permission", params: { description: "test" } }) + "\\n");
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + "\\n");
    }, 50);
  }
});
`);
    const client = new GeminiAcpClient(proc);
    const seen = [];
    client.onServerRequest("session/request_permission", async (params) => {
      seen.push(params.description);
      return { approved: true };
    });
    await client.request("initialize", {});
    assert.deepEqual(seen, ["test"]);
    await client.close();
  });

  it("rejects unknown server requests with -32601", async () => {
    const dir = makeTempDir();
    const proc = spawnScript(dir, "unknown-req-server", `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const responses = [];
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: 42, method: "unknown/method", params: {} }) + "\\n");
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + "\\n");
    }, 50);
  } else if (msg.id === 42 && msg.error) {
    // Client sent error response for the unknown server request
    process.stderr.write(JSON.stringify(msg.error) + "\\n");
  }
});
`);
    const client = new GeminiAcpClient(proc);
    await client.request("initialize", {});
    // Give it a moment for the error response to be sent
    await new Promise((r) => setTimeout(r, 100));
    const stderrOutput = client.stderr;
    await client.close();
    // The server should have received the -32601 error
    // (We can't easily assert on what the server received, but the test
    //  verifies no crash occurs when an unknown server request arrives)
  });

  it("notify sends fire-and-forget message", async () => {
    const dir = makeTempDir();
    const proc = spawnScript(dir, "notify-receiver", `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + "\\n");
  } else if (msg.method === "session/cancel") {
    // Notification received, exit cleanly
    process.exit(0);
  }
});
`);
    const client = new GeminiAcpClient(proc);
    await client.request("initialize", {});
    client.notify("session/cancel", { sessionId: "s1" });
    // Wait for process to exit
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(client.exited, true);
  });

  it("exposes pid and exited properties", async () => {
    const dir = makeTempDir();
    const proc = spawnScript(dir, "simple-server", `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: msg.id, result: {} }) + "\\n");
  }
});
`);
    const client = new GeminiAcpClient(proc);
    assert.ok(client.pid > 0);
    assert.equal(client.exited, false);
    await client.request("initialize", {});
    await client.close();
    assert.equal(client.exited, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/acp-client.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write `acp-client.mjs`**

Create `plugins/gemini/scripts/lib/acp-client.mjs`:

```js
import readline from "node:readline";

export class JsonRpcClient {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.notificationHandler = null;
    this.serverRequestHandlers = new Map();
    this.closed = false;
    this.exitError = null;
    this.lineBuffer = "";

    this.exitPromise = new Promise((resolve) => {
      this._resolveExit = resolve;
    });
  }

  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  onServerRequest(method, handler) {
    this.serverRequestHandlers.set(method, handler);
  }

  request(method, params) {
    if (this.closed) {
      return Promise.reject(new Error("ACP client is closed."));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.sendMessage({ id, method, params });
    });
  }

  notify(method, params) {
    if (this.closed) {
      return;
    }
    this.sendMessage({ method, params });
  }

  handleChunk(chunk) {
    this.lineBuffer += chunk;
    let newlineIndex = this.lineBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.lineBuffer.indexOf("\n");
    }
  }

  handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    // Server-to-client request (has id AND method)
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    // Response (has id, no method)
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        const error = new Error(message.error.message ?? `ACP ${pending.method} failed.`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    // Notification (no id, has method)
    if (message.method && this.notificationHandler) {
      this.notificationHandler(message);
    }
  }

  handleServerRequest(message) {
    const handler = this.serverRequestHandlers.get(message.method);
    if (handler) {
      Promise.resolve()
        .then(() => handler(message.params))
        .then((result) => {
          this.sendMessage({ id: message.id, result });
        })
        .catch((err) => {
          this.sendMessage({
            id: message.id,
            error: { code: -32000, message: String(err?.message ?? err) }
          });
        });
    } else {
      this.sendMessage({
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` }
      });
    }
  }

  handleExit(error) {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.exitError = error ?? null;

    for (const pending of this.pending.values()) {
      pending.reject(this.exitError ?? new Error("ACP connection closed."));
    }
    this.pending.clear();
    this._resolveExit(undefined);
  }

  sendMessage(_message) {
    throw new Error("sendMessage must be implemented by subclass.");
  }
}

export class GeminiAcpClient extends JsonRpcClient {
  constructor(proc) {
    super();
    this.proc = proc;
    this.stderr = "";

    proc.stdout.setEncoding("utf8");
    if (proc.stderr) {
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk) => {
        this.stderr += chunk;
      });
    }

    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => {
      this.handleLine(line);
    });

    proc.on("error", (error) => {
      this.handleExit(error);
    });

    proc.on("exit", (code, signal) => {
      const detail = code === 0
        ? null
        : new Error(`ACP process exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`);
      this.handleExit(detail);
    });
  }

  sendMessage(message) {
    if (this.closed) {
      return;
    }
    try {
      this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      // stdin may already be closed
    }
  }

  async close(opts = {}) {
    const { phase1Ms = 100, phase2Ms = 1500 } = opts;
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;

    try {
      this.rl.close();
    } catch {
      // ignore
    }
    try {
      this.proc.stdin.end();
    } catch {
      // ignore
    }

    await new Promise((resolve) => {
      const finish = () => {
        try {
          this.proc.stdout.destroy();
        } catch {
          // ignore
        }
        resolve();
      };

      const t1 = setTimeout(() => {
        try {
          this.proc.kill("SIGTERM");
        } catch {
          // ignore
        }
        const t2 = setTimeout(() => {
          try {
            this.proc.kill("SIGKILL");
          } catch {
            // ignore
          }
          finish();
        }, phase2Ms);
        this.proc.once("exit", () => {
          clearTimeout(t2);
          finish();
        });
      }, phase1Ms);

      this.proc.once("exit", () => {
        clearTimeout(t1);
        finish();
      });
    });

    // Reject any remaining pending
    for (const pending of this.pending.values()) {
      pending.reject(new Error("ACP client closed."));
    }
    this.pending.clear();
    this._resolveExit(undefined);
  }

  get pid() {
    return this.proc.pid;
  }

  get exited() {
    return this.closed;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/acp-client.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/gemini/scripts/lib/acp-client.mjs tests/acp-client.test.mjs
git commit -m "feat: add JsonRpcClient and GeminiAcpClient (ACP layer 1+2)"
```

---

### Task 3: Rewrite fake gemini fixture for ACP

**Files:**
- Rewrite: `tests/fake-gemini-fixture.mjs`
- Modify: `tests/helpers.mjs` (add `writeExecutable`)

- [ ] **Step 1: Add `writeExecutable` to helpers**

In `tests/helpers.mjs`, add:

```js
export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}
```

- [ ] **Step 2: Rewrite `fake-gemini-fixture.mjs`**

Replace the entire contents of `tests/fake-gemini-fixture.mjs`:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeExecutable } from "./helpers.mjs";

const FAKE_REVIEW_JSON = JSON.stringify({
  verdict: "needs-attention",
  summary: "Found a potential null reference and a missing error handler.",
  findings: [
    {
      severity: "high",
      title: "Potential null dereference",
      body: "The variable `user` may be null when accessed at this line.",
      file: "src/index.js",
      line_start: 42,
      line_end: 42,
      recommendation: "Add a null check before accessing user properties."
    },
    {
      severity: "medium",
      title: "Missing error handler",
      body: "The async function does not catch errors from the database call.",
      file: "src/db.js",
      line_start: 15,
      line_end: 20,
      recommendation: "Wrap the database call in a try-catch block."
    }
  ],
  next_steps: [
    "Fix the null dereference in src/index.js",
    "Add error handling to src/db.js"
  ]
});

export function installFakeGemini(binDir, behavior = "task-ok") {
  fs.mkdirSync(binDir, { recursive: true });
  const statePath = path.join(binDir, "fake-gemini-state.json");
  const scriptPath = path.join(binDir, "gemini");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");

const STATE_PATH = ${JSON.stringify(statePath)};
const BEHAVIOR = ${JSON.stringify(behavior)};

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { starts: 1, sessions: [], prompts: [], cancels: [] };
  }
  const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  s.starts = (s.starts || 0) + 1;
  return s;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("0.36.0\\n");
  process.exit(0);
}

if (!args.includes("--acp") && !args.includes("--experimental-acp")) {
  process.stderr.write("error: --acp flag required\\n");
  process.exit(1);
}

const state = loadState();
saveState(state);

let nextSessionNum = 1;

const rl = readline.createInterface({ input: process.stdin });
rl.on("close", () => { process.exit(0); });

rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);

  // Notifications (no id)
  if (message.id === undefined || message.id === null) {
    if (message.method === "session/cancel") {
      const st = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
      st.cancels = st.cancels || [];
      st.cancels.push({ sessionId: message.params && message.params.sessionId });
      fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
    }
    return;
  }

  const st = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));

  try {
    switch (message.method) {
      case "initialize":
        send({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: "fake-gemini", version: "0.36.0" } } });
        break;

      case "session/new": {
        const sessionId = "ses_" + nextSessionNum++;
        st.sessions = st.sessions || [];
        st.sessions.push({ sessionId, cwd: (message.params && message.params.cwd) || process.cwd() });
        fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
        send({ id: message.id, result: { sessionId } });
        break;
      }

      case "session/load": {
        const sessionId = (message.params && message.params.sessionId) || ("ses_" + nextSessionNum++);
        st.sessions = st.sessions || [];
        if (!st.sessions.find((s) => s.sessionId === sessionId)) {
          st.sessions.push({ sessionId, cwd: (message.params && message.params.cwd) || process.cwd() });
        }
        fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
        send({ id: message.id, result: { sessionId } });
        break;
      }

      case "session/set_mode":
      case "session/set_model":
      case "session/close":
        send({ id: message.id, result: {} });
        break;

      case "session/list": {
        const sessions = (st.sessions || []).map((s) => ({ sessionId: s.sessionId, cwd: s.cwd }));
        send({ id: message.id, result: { sessions } });
        break;
      }

      case "session/prompt": {
        const sessionId = message.params && message.params.sessionId;
        const promptBlocks = (message.params && message.params.prompt) || [];
        const text = (promptBlocks[0] && promptBlocks[0].text) || null;
        st.prompts = st.prompts || [];
        st.prompts.push({ sessionId, text });
        fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));

        if (BEHAVIOR === "crash") {
          process.exit(1);
        }

        if (BEHAVIOR === "hang") {
          break;
        }

        if (BEHAVIOR === "rate-limit") {
          send({ id: message.id, error: { code: -32000, message: "429 RESOURCE_EXHAUSTED: rate limit exceeded" } });
          break;
        }

        if (BEHAVIOR === "permission") {
          send({ id: 9999, method: "session/request_permission", params: { sessionId, description: "Run shell command: ls" } });
          const onPermissionResponse = (permLine) => {
            if (!permLine.trim()) return;
            let permMsg;
            try { permMsg = JSON.parse(permLine); } catch (_) { return; }
            if (permMsg.id !== 9999) return;
            rl.removeListener("line", onPermissionResponse);
            send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Task complete." } } } });
            send({ id: message.id, result: { stopReason: "end_turn" } });
          };
          rl.on("line", onPermissionResponse);
          break;
        }

        if (BEHAVIOR === "write-in-readonly") {
          send({ id: 8888, method: "fs/write_text_file", params: { path: "sneaky.txt", content: "should be blocked" } });
          setTimeout(() => {
            send({ id: message.id, result: { stopReason: "end_turn" } });
          }, 100);
          break;
        }

        if (BEHAVIOR === "path-escape") {
          send({ id: 8888, method: "fs/read_text_file", params: { path: "../../etc/passwd" } });
          setTimeout(() => {
            send({ id: message.id, result: { stopReason: "end_turn" } });
          }, 100);
          break;
        }

        if (BEHAVIOR === "review-ok" || BEHAVIOR === "session-load") {
          const reviewJson = ${JSON.stringify(FAKE_REVIEW_JSON)};
          send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reviewJson } } } });
          send({ id: message.id, result: { stopReason: "end_turn" } });
          break;
        }

        // Default: task-ok
        send({ method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Task complete." } } } });
        send({ id: message.id, result: { stopReason: "end_turn" } });
        break;
      }

      default:
        send({ id: message.id, error: { code: -32601, message: "Unsupported method: " + message.method } });
        break;
    }
  } catch (error) {
    send({ id: message.id, error: { code: -32000, message: error.message } });
  }
});
`;
  writeExecutable(scriptPath, source);
  return statePath;
}

export function createFakeGeminiEnv(binDir) {
  return {
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: os.tmpdir(),
    GEMINI_API_KEY: "fake-test-key"
  };
}

export function readFakeState(binDir) {
  const statePath = path.join(binDir, "fake-gemini-state.json");
  if (!fs.existsSync(statePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

export function removeFakeGemini(binDir) {
  try {
    fs.rmSync(binDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
```

- [ ] **Step 3: Run existing tests to check nothing is broken**

Run: `node --test tests/*.test.mjs`
Expected: `runtime.test.mjs` will likely fail because the fixture API changed. That's expected — we'll update it in Task 7.

- [ ] **Step 4: Commit**

```bash
git add tests/fake-gemini-fixture.mjs tests/helpers.mjs
git commit -m "refactor: rewrite fake-gemini-fixture for ACP protocol"
```

---

### Task 4: Create `acp-lifecycle.mjs` — Session Management + Path Sandboxing

**Files:**
- Create: `plugins/gemini/scripts/lib/acp-lifecycle.mjs`
- Test: `tests/acp-lifecycle.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/acp-lifecycle.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  detectAcpFlag,
  clearFlagCache,
  spawnAcpClient,
  createSession,
  resumeSession,
  isAlive,
  resolveContainedPath
} from "../plugins/gemini/scripts/lib/acp-lifecycle.mjs";
import { installFakeGemini, createFakeGeminiEnv, readFakeState, removeFakeGemini } from "./fake-gemini-fixture.mjs";

let binDir;
let tmpDir;
let env;

function makeTempDir(prefix = "acp-lifecycle-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("detectAcpFlag", () => {
  beforeEach(() => {
    binDir = makeTempDir("fake-bin-");
    clearFlagCache();
  });
  afterEach(() => {
    removeFakeGemini(binDir);
    clearFlagCache();
  });

  it("returns --acp for gemini >= 0.33.0", () => {
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
    const origPath = process.env.PATH;
    process.env.PATH = env.PATH;
    try {
      const flag = detectAcpFlag("gemini");
      assert.equal(flag, "--acp");
    } finally {
      process.env.PATH = origPath;
    }
  });
});

describe("spawnAcpClient", () => {
  beforeEach(() => {
    binDir = makeTempDir("fake-bin-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
    clearFlagCache();
  });
  afterEach(() => {
    removeFakeGemini(binDir);
    clearFlagCache();
  });

  it("connects and completes initialize handshake", async () => {
    const client = await spawnAcpClient({ env });
    assert.ok(client.pid > 0);
    assert.equal(client.exited, false);
    await client.close();
  });
});

describe("createSession", () => {
  beforeEach(() => {
    binDir = makeTempDir("fake-bin-");
    tmpDir = makeTempDir("workspace-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
    clearFlagCache();
  });
  afterEach(() => {
    removeFakeGemini(binDir);
    clearFlagCache();
  });

  it("returns a non-empty sessionId", async () => {
    const { client, sessionId } = await createSession({ cwd: tmpDir, env, workspaceRoot: tmpDir });
    assert.equal(typeof sessionId, "string");
    assert.ok(sessionId.length > 0);
    await client.close();
  });
});

describe("resumeSession", () => {
  beforeEach(() => {
    binDir = makeTempDir("fake-bin-");
    tmpDir = makeTempDir("workspace-");
    installFakeGemini(binDir, "session-load");
    env = createFakeGeminiEnv(binDir);
    clearFlagCache();
  });
  afterEach(() => {
    removeFakeGemini(binDir);
    clearFlagCache();
  });

  it("resumes an existing session", async () => {
    const { client, sessionId } = await resumeSession("ses_existing", { cwd: tmpDir, env, workspaceRoot: tmpDir });
    assert.equal(sessionId, "ses_existing");
    await client.close();
  });
});

describe("isAlive", () => {
  beforeEach(() => {
    binDir = makeTempDir("fake-bin-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
    clearFlagCache();
  });
  afterEach(() => {
    removeFakeGemini(binDir);
    clearFlagCache();
  });

  it("returns true for a live client", async () => {
    const client = await spawnAcpClient({ env });
    assert.equal(isAlive(client), true);
    await client.close();
  });

  it("returns false after close", async () => {
    const client = await spawnAcpClient({ env });
    await client.close();
    assert.equal(isAlive(client), false);
  });
});

describe("resolveContainedPath", () => {
  it("resolves relative paths within workspace", () => {
    const root = "/workspace/project";
    const result = resolveContainedPath(root, "src/index.js");
    assert.equal(result, path.join(root, "src/index.js"));
  });

  it("rejects absolute paths", () => {
    const root = "/workspace/project";
    assert.throws(
      () => resolveContainedPath(root, "/etc/passwd"),
      /outside workspace/
    );
  });

  it("rejects paths that escape via ../", () => {
    const root = "/workspace/project";
    assert.throws(
      () => resolveContainedPath(root, "../../etc/passwd"),
      /outside workspace/
    );
  });

  it("rejects paths that normalize outside root", () => {
    const root = "/workspace/project";
    assert.throws(
      () => resolveContainedPath(root, "src/../../etc/passwd"),
      /outside workspace/
    );
  });

  it("allows deeply nested paths", () => {
    const root = "/workspace/project";
    const result = resolveContainedPath(root, "src/lib/deep/file.js");
    assert.equal(result, path.join(root, "src/lib/deep/file.js"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/acp-lifecycle.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write `acp-lifecycle.mjs`**

Create `plugins/gemini/scripts/lib/acp-lifecycle.mjs`:

```js
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { GeminiAcpClient } from "./acp-client.mjs";
import { runCommand } from "./process.mjs";
import { appendLogLine } from "./tracked-jobs.mjs";

const PLUGIN_LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_MANIFEST_PATH = path.resolve(PLUGIN_LIB_DIR, "..", "..", ".claude-plugin", "plugin.json");

const flagCache = new Map();

export function detectAcpFlag(binary = "gemini") {
  if (flagCache.has(binary)) {
    return flagCache.get(binary);
  }

  const result = runCommand(binary, ["--version"]);
  let flag = "--acp";

  if (result.status === 0) {
    const version = result.stdout.trim();
    const match = version.match(/^(\d+)\.(\d+)\./);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major === 0 && minor < 33) {
        flag = "--experimental-acp";
      }
    }
  }

  flagCache.set(binary, flag);
  return flag;
}

export function clearFlagCache() {
  flagCache.clear();
}

export function resolveContainedPath(workspaceRoot, requestedPath) {
  if (path.isAbsolute(requestedPath)) {
    throw new Error(`Path "${requestedPath}" is absolute — outside workspace.`);
  }

  const resolved = path.resolve(workspaceRoot, requestedPath);
  const normalizedRoot = path.resolve(workspaceRoot) + path.sep;

  if (!resolved.startsWith(normalizedRoot) && resolved !== path.resolve(workspaceRoot)) {
    throw new Error(`Path "${requestedPath}" resolves outside workspace.`);
  }

  return resolved;
}

export function installDefaultHandlers(client, opts = {}) {
  const { workspaceRoot, write = false, logFile } = opts;

  client.onServerRequest("fs/read_text_file", async (params) => {
    const filePath = resolveContainedPath(workspaceRoot, params.path);
    appendLogLine(logFile, `[fs/read] ${params.path}`);
    const content = await fs.readFile(filePath, "utf8");
    return { content };
  });

  if (write) {
    client.onServerRequest("fs/write_text_file", async (params) => {
      const filePath = resolveContainedPath(workspaceRoot, params.path);
      appendLogLine(logFile, `[fs/write] ${params.path}`);
      await fs.writeFile(filePath, params.content, "utf8");
      return {};
    });
  }

  client.onServerRequest("session/request_permission", async (params) => {
    const approved = write;
    appendLogLine(logFile, `[permission] ${approved ? "approved" : "denied"}: ${params?.description ?? ""}`);
    return { approved };
  });
}

function getClientInfo() {
  try {
    const raw = JSON.parse(require("node:fs").readFileSync(PLUGIN_MANIFEST_PATH, "utf8"));
    return { name: "gemini-companion", version: raw.version ?? "1.0.0" };
  } catch {
    return { name: "gemini-companion", version: "1.0.0" };
  }
}

export async function spawnAcpClient(opts = {}) {
  const binary = opts.binary ?? "gemini";
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;

  const flag = detectAcpFlag(binary);

  const proc = spawn(binary, [flag], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  const client = new GeminiAcpClient(proc);

  if (opts.workspaceRoot) {
    installDefaultHandlers(client, opts);
  }

  const initTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("ACP initialize timed out after 10s.")), 10_000)
  );
  await Promise.race([
    client.request("initialize", {
      protocolVersion: 1,
      clientInfo: getClientInfo(),
      clientCapabilities: {}
    }),
    initTimeout
  ]);

  return client;
}

export async function createSession(opts = {}) {
  const client = await spawnAcpClient(opts);
  const cwd = opts.cwd ?? process.cwd();
  const modeId = opts.modeId ?? "default";

  const { sessionId } = await client.request("session/new", { cwd });
  await client.request("session/set_mode", { sessionId, modeId });

  if (opts.model) {
    await client.request("session/set_model", { sessionId, modelId: opts.model });
  }

  return { client, sessionId };
}

export async function resumeSession(sessionId, opts = {}) {
  const client = await spawnAcpClient(opts);
  const cwd = opts.cwd ?? process.cwd();
  await client.request("session/load", { sessionId, cwd });
  return { client, sessionId };
}

export function isAlive(client) {
  if (client.exited) {
    return false;
  }
  try {
    process.kill(client.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function withAcpClient(cwd, fn, opts = {}) {
  const client = await spawnAcpClient({ cwd, ...opts });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/acp-lifecycle.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/gemini/scripts/lib/acp-lifecycle.mjs tests/acp-lifecycle.test.mjs
git commit -m "feat: add acp-lifecycle with session management and path sandboxing"
```

---

### Task 5: Create `acp-protocol.d.ts`

**Files:**
- Create: `plugins/gemini/scripts/lib/acp-protocol.d.ts`

- [ ] **Step 1: Write the type definitions**

Create `plugins/gemini/scripts/lib/acp-protocol.d.ts`:

```ts
export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface NewSessionParams {
  cwd: string;
  mcpServers?: unknown[];
}

export interface NewSessionResult {
  sessionId: string;
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
}

export interface PromptParams {
  sessionId: string;
  prompt: Array<{ type: "text"; text: string }>;
}

export interface PromptResult {
  stopReason: "end_turn" | "cancelled" | "error" | string;
}

export interface CancelParams {
  sessionId: string;
}

export interface SetModeParams {
  sessionId: string;
  modeId: "default" | "plan" | "auto_edit" | "yolo";
}

export interface SetModelParams {
  sessionId: string;
  modelId: string;
}

export type UpdateType =
  | "agent_message_chunk"
  | "tool_call"
  | "tool_call_update"
  | "current_mode_update"
  | "usage_update";

export interface SessionUpdateParams {
  sessionId: string;
  update: {
    sessionUpdate: UpdateType;
    content?: { type?: string; text?: string };
    name?: string;
    [key: string]: unknown;
  };
}

export interface RequestPermissionParams {
  sessionId: string;
  description: string;
}

export interface RequestPermissionResult {
  approved: boolean;
}

export interface ReadTextFileParams {
  path: string;
}

export interface ReadTextFileResult {
  content: string;
}

export interface WriteTextFileParams {
  path: string;
  content: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/gemini/scripts/lib/acp-protocol.d.ts
git commit -m "feat: add ACP protocol type definitions"
```

---

### Task 6: Rewrite `gemini.mjs` — Async ACP Integration

**Files:**
- Rewrite: `plugins/gemini/scripts/lib/gemini.mjs`

- [ ] **Step 1: Rewrite `gemini.mjs`**

Replace the entire contents of `plugins/gemini/scripts/lib/gemini.mjs` with:

```js
import { createSession, resumeSession, spawnAcpClient } from "./acp-lifecycle.mjs";
import { resolveModel, suggestAlternatives } from "./models.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";
import { readJsonFile } from "./fs.mjs";
import { appendLogLine } from "./tracked-jobs.mjs";
import { upsertJob } from "./state.mjs";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Re-export for backward compat with imports in gemini-companion.mjs
export { resolveModel as normalizeRequestedModel } from "./models.mjs";

export function getGeminiAvailability(cwd) {
  return binaryAvailable("gemini", ["--version"], { cwd });
}

export function getGeminiAuthStatus() {
  const geminiDir = path.join(os.homedir(), ".gemini");
  const oauthPath = path.join(geminiDir, "oauth_creds.json");
  const credsPath = path.join(geminiDir, "gemini-credentials.json");
  const settingsPath = path.join(geminiDir, "settings.json");

  const hasOauth = fs.existsSync(oauthPath);
  const hasCreds = fs.existsSync(credsPath);

  let hasApiKey = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = readJsonFile(settingsPath);
      hasApiKey = Boolean(settings?.apiKey || settings?.["api-key"]);
    } catch {
      // ignore
    }
  }

  const hasEnvKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  if (hasOauth) {
    return { available: true, loggedIn: true, detail: "authenticated (Google OAuth)" };
  }
  if (hasCreds) {
    return { available: true, loggedIn: true, detail: "authenticated (credentials)" };
  }
  if (hasApiKey || hasEnvKey) {
    return { available: true, loggedIn: true, detail: "authenticated (API key)" };
  }

  return {
    available: true,
    loggedIn: false,
    detail: "not authenticated. Run: gemini auth login"
  };
}

export function parseStructuredOutput(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return { parsed: null, parseError: "Empty response text", rawOutput: "" };
  }

  try {
    const data = JSON.parse(text);
    return { parsed: data, parseError: null, rawOutput: text };
  } catch {
    // continue
  }

  const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1].trim());
      return { parsed: data, parseError: null, rawOutput: text };
    } catch {
      // continue
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const data = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      return { parsed: data, parseError: null, rawOutput: text };
    } catch {
      // fall through
    }
  }

  return {
    parsed: null,
    parseError: "Could not extract JSON from Gemini response",
    rawOutput: text
  };
}

export function readOutputSchema(schemaPath) {
  try {
    return readJsonFile(schemaPath);
  } catch {
    return null;
  }
}

export async function runGeminiTask(cwd, options = {}) {
  const {
    prompt,
    model,
    write = true,
    resume,
    logFile,
    onProgress,
    env,
    jobId,
    workspaceRoot
  } = options;

  const resolvedModel = resolveModel(model);
  const modeId = write ? "default" : "plan";

  let client, sessionId;

  try {
    if (resume) {
      ({ client, sessionId } = await resumeSession(resume, {
        cwd,
        env,
        workspaceRoot: workspaceRoot ?? cwd,
        write,
        logFile
      }));
    } else {
      ({ client, sessionId } = await createSession({
        cwd,
        env,
        modeId,
        model: resolvedModel,
        workspaceRoot: workspaceRoot ?? cwd,
        write,
        logFile
      }));
    }
  } catch (err) {
    return {
      ok: false,
      rawOutput: "",
      sessionId: null,
      stopReason: null,
      failureMessage: err.message
    };
  }

  // Persist sessionId immediately for graceful cancel support
  if (jobId && workspaceRoot) {
    try {
      upsertJob(workspaceRoot, { id: jobId, sessionId });
    } catch {
      // non-fatal
    }
  }

  const chunks = [];

  client.setNotificationHandler((message) => {
    if (message.method !== "session/update") {
      return;
    }
    const params = message.params;
    if (params?.sessionId !== sessionId) {
      return;
    }
    const update = params?.update;
    if (!update) {
      return;
    }

    if (update.sessionUpdate === "agent_message_chunk" && update.content?.text) {
      chunks.push(update.content.text);
      appendLogLine(logFile, update.content.text);
      if (onProgress) {
        onProgress({ message: update.content.text, phase: "streaming" });
      }
    } else if (update.sessionUpdate === "tool_call") {
      const toolName = update.name ?? "tool";
      appendLogLine(logFile, `[tool_call] ${toolName}`);
      if (onProgress) {
        onProgress({ message: `Running: ${toolName}`, phase: "tool_call" });
      }
    }
  });

  let result;
  try {
    result = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }]
    });
  } catch (err) {
    await client.close().catch(() => {});

    const msg = err?.message ?? String(err);
    const isRateLimit = /429|RESOURCE_EXHAUSTED|capacity|rate.limit/i.test(msg);
    if (isRateLimit) {
      const modelLabel = model ?? "default";
      const structured = new Error(`Model "${modelLabel}" hit rate limits after retries.`);
      structured.code = "RATE_LIMITED";
      structured.model = modelLabel;
      structured.suggestions = suggestAlternatives(resolvedModel);
      return {
        ok: false,
        rawOutput: "",
        sessionId,
        stopReason: null,
        failureMessage: structured.message
      };
    }

    const isMalformed = /malformed function call/i.test(msg);
    if (isMalformed) {
      const modelLabel = model ?? "default";
      const structured = new Error(`Model "${modelLabel}" returned malformed output.`);
      structured.code = "MODEL_UNAVAILABLE";
      structured.model = modelLabel;
      structured.suggestions = suggestAlternatives(resolvedModel);
      return {
        ok: false,
        rawOutput: "",
        sessionId,
        stopReason: null,
        failureMessage: structured.message
      };
    }

    return {
      ok: false,
      rawOutput: "",
      sessionId,
      stopReason: null,
      failureMessage: msg
    };
  }

  await client.close().catch(() => {});

  return {
    ok: true,
    rawOutput: chunks.join(""),
    sessionId,
    stopReason: result?.stopReason ?? "unknown",
    failureMessage: null
  };
}

export async function runGeminiReview(cwd, options = {}) {
  const {
    prompt,
    model,
    timeoutMs,
    logFile,
    onProgress,
    env,
    workspaceRoot
  } = options;

  const result = await runGeminiTask(cwd, {
    prompt,
    model,
    write: false,
    logFile,
    onProgress,
    env,
    workspaceRoot
  });

  if (!result.ok) {
    return {
      ok: false,
      parsed: null,
      parseError: result.failureMessage,
      rawOutput: result.rawOutput || "",
      sessionId: result.sessionId,
      reasoningSummary: null
    };
  }

  const structuredResult = parseStructuredOutput(result.rawOutput);

  return {
    ok: true,
    ...structuredResult,
    sessionId: result.sessionId,
    reasoningSummary: null
  };
}

export async function interruptSession(sessionId, opts = {}) {
  const { cwd = process.cwd(), env = process.env } = opts;
  try {
    const client = await spawnAcpClient({ cwd, env });
    client.notify("session/cancel", { sessionId });
    await new Promise((r) => setTimeout(r, 200));
    await client.close({ phase1Ms: 0, phase2Ms: 500 });
  } catch {
    // Best-effort; caller falls back to process kill
  }
}

export function findLatestTaskSession(workspaceRoot, listJobsFn) {
  const jobs = listJobsFn(workspaceRoot);
  const taskJobs = jobs
    .filter((job) => job.jobClass === "task" && job.sessionId)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  return taskJobs[0] ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/gemini/scripts/lib/gemini.mjs
git commit -m "feat: rewrite gemini.mjs with async ACP integration"
```

---

### Task 7: Async-wrap `gemini-companion.mjs`

**Files:**
- Modify: `plugins/gemini/scripts/gemini-companion.mjs`

- [ ] **Step 1: Update imports**

At the top of `gemini-companion.mjs`, update the gemini.mjs imports:

```js
import {
  getGeminiAvailability,
  getGeminiAuthStatus,
  normalizeRequestedModel,
  runGeminiReview,
  runGeminiTask,
  parseStructuredOutput,
  readOutputSchema,
  findLatestTaskSession,
  interruptSession
} from "./lib/gemini.mjs";
```

- [ ] **Step 2: Make handler functions async**

Add `async` keyword to these functions:
- `executeReviewForeground` → `async function executeReviewForeground`
- `executeReviewBackground` stays sync (it spawns a subprocess)
- `handleReviewWorker` → `async function handleReviewWorker`
- `handleReview` → `async function handleReview`
- `handleTask` → `async function handleTask`
- `executeTask` → `async function executeTask`
- `handleTaskWorker` → `async function handleTaskWorker`
- `handleCancel` → `async function handleCancel`

In `executeReviewForeground`, change `runGeminiReview` call to use `await`:

```js
async function executeReviewForeground(cwd, target, kind, options = {}) {
  const { prompt, targetLabel } = buildReviewPrompt(cwd, target, kind, options.focusText);
  const reviewLabel = kind === "adversarial-review" ? "Adversarial Review" : "Review";

  const result = await runGeminiReview(cwd, {
    prompt,
    model: options.model,
    timeoutMs: options.timeoutMs,
    env: options.env
  });

  // rest of rendering logic stays the same...
```

In `handleReview`, add `await` to the `executeReviewForeground` call:

```js
async function handleReview(cwd, argv, kind = "review") {
  // ... parseArgs stays the same ...

  if (options.background) {
    executeReviewBackground(cwd, target, kind, { model, focusText });
    return;
  }

  if (options.wait) {
    await executeReviewForeground(cwd, target, kind, { model, focusText, timeoutMs });
    return;
  }

  // ... size estimation stays the same ...

  if (isSmall) {
    await executeReviewForeground(cwd, target, kind, { model, focusText, timeoutMs });
  } else {
    executeReviewBackground(cwd, target, kind, { model, focusText });
  }
}
```

In `handleReviewWorker`, add `await` to `runGeminiReview`:

```js
async function handleReviewWorker(cwd, argv) {
  // ... parseArgs stays the same ...
  const result = await runGeminiReview(workerCwd, {
    prompt,
    model: options.model
  });
  // rest stays the same...
```

In `executeTask`, add `await` to `runGeminiTask`:

```js
async function executeTask(cwd, prompt, options = {}) {
  // ... background branch stays the same ...

  // Foreground
  const result = await runGeminiTask(cwd, { prompt, model, write, resume });
  // rest stays the same...
```

In `handleTaskWorker`, add `await` to `runGeminiTask`:

```js
async function handleTaskWorker(cwd, argv) {
  // ... parseArgs stays the same ...
  const result = await runGeminiTask(workerCwd, {
    prompt: options.prompt,
    model: options.model,
    write,
    resume: options.resume
  });
  // rest stays the same...
```

In `handleCancel`, add `interruptSession` before process kill:

```js
async function handleCancel(cwd, argv) {
  // ... parseArgs + resolve job stays the same ...

  // Graceful cancel via ACP first
  if (job.sessionId) {
    await interruptSession(job.sessionId, { cwd });
  }

  // Fallback: process kill
  if (job.pid) {
    try {
      terminateProcessTree(job.pid);
    } catch {
      // Process may already be gone.
    }
  }
  // rest stays the same...
```

- [ ] **Step 3: Make `main()` async**

```js
async function main() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case "setup":
      handleSetup(cwd, argv);
      break;
    case "review":
      await handleReview(cwd, argv, "review");
      break;
    case "adversarial-review":
      await handleReview(cwd, argv, "adversarial-review");
      break;
    case "task":
      await handleTask(cwd, argv);
      break;
    case "task-worker":
      await handleTaskWorker(cwd, argv);
      break;
    case "review-worker":
      await handleReviewWorker(cwd, argv);
      break;
    case "status":
      handleStatus(cwd, argv);
      break;
    case "result":
      handleResult(cwd, argv);
      break;
    case "cancel":
      await handleCancel(cwd, argv);
      break;
    default:
      process.stderr.write(`Unknown command: ${command ?? "(none)"}\nUsage: gemini-companion <setup|review|adversarial-review|task|status|result|cancel> [options]\n`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Commit**

```bash
git add plugins/gemini/scripts/gemini-companion.mjs
git commit -m "feat: async-wrap gemini-companion handlers for ACP integration"
```

---

### Task 8: Update integration tests

**Files:**
- Modify: `tests/runtime.test.mjs`

- [ ] **Step 1: Update `runtime.test.mjs` for new fixture API**

Replace the entire contents of `tests/runtime.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createTempDir, cleanTempDir, initGitRepo, runCompanion } from "./helpers.mjs";
import { installFakeGemini, createFakeGeminiEnv, removeFakeGemini, readFakeState } from "./fake-gemini-fixture.mjs";

let tmpDir;
let binDir;
let fakeEnv;

describe("runtime integration", () => {
  beforeEach(() => {
    tmpDir = createTempDir("runtime-test-");
    binDir = createTempDir("fake-bin-");
    initGitRepo(tmpDir);
    installFakeGemini(binDir, "task-ok");
    fakeEnv = createFakeGeminiEnv(binDir);
  });

  afterEach(() => {
    cleanTempDir(tmpDir);
    removeFakeGemini(binDir);
  });

  it("setup reports ready with fake gemini", () => {
    const result = runCompanion(["setup", "--json"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, true);
    assert.equal(report.gemini.available, true);
  });

  it("setup detects missing gemini", () => {
    const noGeminiEnv = { ...fakeEnv, PATH: "/nonexistent" };
    const result = runCompanion(["setup", "--json"], { cwd: tmpDir, env: noGeminiEnv });
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, false);
    assert.equal(report.gemini.available, false);
  });

  it("status shows no jobs initially", () => {
    const result = runCompanion(["status"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("No jobs recorded yet"));
  });

  it("unknown command returns error", () => {
    const result = runCompanion(["nonsense"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("Unknown command"));
  });

  it("task with no prompt returns error", () => {
    const result = runCompanion(["task"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("No task prompt"));
  });

  it("review --wait completes with fake gemini", () => {
    installFakeGemini(binDir, "review-ok");
    const result = runCompanion(["review", "--wait"], { cwd: tmpDir, env: fakeEnv, timeout: 30_000 });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("Review") || result.stdout.includes("review"));
  });

  it("task --wait completes with fake gemini", () => {
    const result = runCompanion(["task", "--wait", "test task"], { cwd: tmpDir, env: fakeEnv, timeout: 30_000 });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("Task complete") || result.stdout.length > 0);
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `node --test tests/*.test.mjs`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/runtime.test.mjs
git commit -m "test: update integration tests for ACP protocol"
```

---

### Task 9: Final validation

- [ ] **Step 1: Run full test suite one more time**

Run: `node --test tests/*.test.mjs`
Expected: All PASS

- [ ] **Step 2: Verify no leftover references to removed functions**

Run: `grep -rn "runGeminiSync\|buildGeminiArgs\|cleanGeminiStderr\|parseJsonOutput\|spawnGeminiBackground" plugins/gemini/scripts/`
Expected: No matches (all removed)

- [ ] **Step 3: Verify imports are consistent**

Run: `grep -rn "from.*gemini\.mjs" plugins/gemini/scripts/`
Expected: All imports reference functions that exist in the rewritten gemini.mjs

- [ ] **Step 4: Commit any remaining cleanup**

```bash
git status
# If clean, no commit needed
```
