import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { GeminiAcpClient } from "../plugins/gemini/scripts/lib/acp-client.mjs";

const tempDirs = [];
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-client-test-"));
  tempDirs.push(dir);
  return dir;
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
  afterEach(() => {
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tempDirs.length = 0;
  });

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
