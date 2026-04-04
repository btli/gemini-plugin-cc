import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  detectAcpFlag,
  clearFlagCache,
  resolveContainedPath,
  spawnAcpClient,
  createSession,
  resumeSession,
  isAlive,
} from "../plugins/gemini/scripts/lib/acp-lifecycle.mjs";

function makeTempDir(prefix = "acp-lifecycle-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function installMinimalFake(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, "gemini");
  fs.writeFileSync(
    script,
    `#!/usr/bin/env node
const readline = require("node:readline");
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write("0.36.0\\n"); process.exit(0); }
if (!args.includes("--acp")) { process.exit(1); }
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  const send = (r) => process.stdout.write(JSON.stringify(r) + "\\n");
  switch(msg.method) {
    case "initialize": send({id:msg.id, result:{protocolVersion:1}}); break;
    case "session/new": send({id:msg.id, result:{sessionId:"ses_1"}}); break;
    case "session/load": send({id:msg.id, result:{sessionId:msg.params.sessionId}}); break;
    case "session/set_mode": case "session/set_model": send({id:msg.id, result:{}}); break;
    default: send({id:msg.id, result:{}}); break;
  }
});
`,
    { mode: 0o755 }
  );
}

function makeEnv(binDir) {
  return {
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: os.tmpdir(),
    GEMINI_API_KEY: "fake",
  };
}

describe("detectAcpFlag", () => {
  let binDir;
  let env;

  beforeEach(() => {
    clearFlagCache();
    binDir = makeTempDir();
    installMinimalFake(binDir);
    env = makeEnv(binDir);
  });

  it("returns --acp for >= 0.33.0", () => {
    const flag = detectAcpFlag(path.join(binDir, "gemini"));
    assert.equal(flag, "--acp");
  });
});

describe("spawnAcpClient", () => {
  let binDir;
  let env;

  beforeEach(() => {
    clearFlagCache();
    binDir = makeTempDir();
    installMinimalFake(binDir);
    env = makeEnv(binDir);
  });

  it("connects and completes initialize handshake", async () => {
    const client = await spawnAcpClient({
      binary: path.join(binDir, "gemini"),
      env,
    });
    assert.ok(client);
    assert.ok(client.pid > 0);
    assert.equal(client.exited, false);
    await client.close();
  });
});

describe("createSession", () => {
  let binDir;
  let env;

  beforeEach(() => {
    clearFlagCache();
    binDir = makeTempDir();
    installMinimalFake(binDir);
    env = makeEnv(binDir);
  });

  it("returns a non-empty sessionId", async () => {
    const { client, sessionId } = await createSession({
      binary: path.join(binDir, "gemini"),
      env,
    });
    assert.ok(sessionId);
    assert.equal(sessionId, "ses_1");
    await client.close();
  });
});

describe("resumeSession", () => {
  let binDir;
  let env;

  beforeEach(() => {
    clearFlagCache();
    binDir = makeTempDir();
    installMinimalFake(binDir);
    env = makeEnv(binDir);
  });

  it("resumes an existing session", async () => {
    const { client, sessionId } = await resumeSession("ses_existing", {
      binary: path.join(binDir, "gemini"),
      env,
    });
    assert.equal(sessionId, "ses_existing");
    await client.close();
  });
});

describe("isAlive", () => {
  let binDir;
  let env;

  beforeEach(() => {
    clearFlagCache();
    binDir = makeTempDir();
    installMinimalFake(binDir);
    env = makeEnv(binDir);
  });

  it("returns true for live client, false after close", async () => {
    const client = await spawnAcpClient({
      binary: path.join(binDir, "gemini"),
      env,
    });
    assert.equal(isAlive(client), true);
    await client.close();
    assert.equal(isAlive(client), false);
  });
});

describe("resolveContainedPath", () => {
  let workspace;

  beforeEach(() => {
    workspace = makeTempDir("workspace-");
  });

  it("resolves relative paths within workspace", () => {
    const resolved = resolveContainedPath(workspace, "src/main.js");
    assert.equal(resolved, path.join(workspace, "src", "main.js"));
  });

  it("rejects absolute paths", () => {
    assert.throws(
      () => resolveContainedPath(workspace, "/etc/passwd"),
      /outside workspace/
    );
  });

  it("rejects ../ escape attempts", () => {
    assert.throws(
      () => resolveContainedPath(workspace, "../../../etc/passwd"),
      /outside workspace/
    );
  });

  it("rejects normalized escape paths", () => {
    assert.throws(
      () => resolveContainedPath(workspace, "subdir/../../etc/passwd"),
      /outside workspace/
    );
  });

  it("allows deeply nested relative paths", () => {
    const resolved = resolveContainedPath(workspace, "a/b/c/d/e/f.txt");
    assert.equal(resolved, path.join(workspace, "a", "b", "c", "d", "e", "f.txt"));
  });
});
