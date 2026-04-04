import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  detectAcpFlag,
  clearFlagCache,
  resolveContainedPath,
  spawnAcpClient,
  createSession,
  resumeSession,
  isAlive,
} from "../plugins/gemini/scripts/lib/acp-lifecycle.mjs";
import { createTempDir } from "./helpers.mjs";
import { installFakeGemini, createFakeGeminiEnv, removeFakeGemini } from "./fake-gemini-fixture.mjs";

describe("detectAcpFlag", () => {
  let binDir;
  let env;

  beforeEach(() => {
    clearFlagCache();
    binDir = createTempDir("acp-lifecycle-test-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
  });

  afterEach(() => {
    removeFakeGemini(binDir);
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
    binDir = createTempDir("acp-lifecycle-test-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
  });

  afterEach(() => {
    removeFakeGemini(binDir);
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
    binDir = createTempDir("acp-lifecycle-test-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
  });

  afterEach(() => {
    removeFakeGemini(binDir);
  });

  it("returns a non-empty sessionId", async () => {
    const { client, sessionId } = await createSession({
      binary: path.join(binDir, "gemini"),
      env,
    });
    assert.ok(sessionId);
    await client.close();
  });
});

describe("resumeSession", () => {
  let binDir;
  let env;

  beforeEach(() => {
    clearFlagCache();
    binDir = createTempDir("acp-lifecycle-test-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
  });

  afterEach(() => {
    removeFakeGemini(binDir);
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
    binDir = createTempDir("acp-lifecycle-test-");
    installFakeGemini(binDir, "task-ok");
    env = createFakeGeminiEnv(binDir);
  });

  afterEach(() => {
    removeFakeGemini(binDir);
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
    workspace = createTempDir("workspace-");
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
