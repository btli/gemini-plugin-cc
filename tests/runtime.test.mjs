import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createTempDir, cleanTempDir, initGitRepo, runCompanion } from "./helpers.mjs";
import { installFakeGemini, createFakeGeminiEnv, removeFakeGemini } from "./fake-gemini-fixture.mjs";

let tmpDir;
let binDir;
let fakeEnv;

describe("runtime integration", () => {
  beforeEach(() => {
    tmpDir = createTempDir("runtime-test-");
    binDir = createTempDir("fake-bin-");
    initGitRepo(tmpDir);
    installFakeGemini(binDir);
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
});
