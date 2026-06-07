import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createTempDir, cleanTempDir, initGitRepo, runCompanion } from "./helpers.mjs";
import { installFakeAgy, createFakeAgyEnv, removeFakeAgy } from "./fake-agy-fixture.mjs";

let tmpDir;
let binDir;
let fakeEnv;

describe("runtime integration", () => {
  beforeEach(() => {
    tmpDir = createTempDir("runtime-test-");
    binDir = createTempDir("fake-bin-");
    initGitRepo(tmpDir);
    installFakeAgy(binDir, "task-ok");
    fakeEnv = createFakeAgyEnv(binDir);
  });

  afterEach(() => {
    cleanTempDir(tmpDir);
    removeFakeAgy(binDir);
  });

  it("setup reports ready with fake agy", () => {
    const result = runCompanion(["setup", "--json"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, true);
    assert.equal(report.agy.available, true);
    assert.equal(report.auth.loggedIn, true);
  });

  it("setup detects missing agy", () => {
    const noAgyEnv = { ...fakeEnv, PATH: "/nonexistent" };
    const result = runCompanion(["setup", "--json"], { cwd: tmpDir, env: noAgyEnv });
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, false);
    assert.equal(report.agy.available, false);
    assert.ok(report.nextSteps.some((step) => step.includes("Install the Antigravity CLI")));
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

  it("task --wait completes with fake agy", () => {
    const result = runCompanion(["task", "--wait", "test task"], {
      cwd: tmpDir,
      env: fakeEnv,
      timeout: 30_000
    });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("TASK_COMPLETE"), `expected task output, got: ${result.stdout.slice(0, 200)}`);
  });

  it("review --wait completes with fake agy and renders findings", () => {
    const reviewBinDir = createTempDir("fake-bin-review-");
    installFakeAgy(reviewBinDir, "review-ok");
    const reviewEnv = createFakeAgyEnv(reviewBinDir);
    try {
      const result = runCompanion(["review", "--wait"], { cwd: tmpDir, env: reviewEnv, timeout: 30_000 });
      assert.equal(result.status, 0);
      assert.ok(result.stdout.length > 0, "stdout should be non-empty");
      assert.ok(
        result.stdout.includes("Verdict") || result.stdout.includes("needs-attention"),
        `expected review output, got: ${result.stdout.slice(0, 200)}`
      );
    } finally {
      removeFakeAgy(reviewBinDir);
    }
  });

  it("task failure surfaces the agy error", () => {
    const failBinDir = createTempDir("fake-bin-fail-");
    installFakeAgy(failBinDir, "fail");
    const failEnv = createFakeAgyEnv(failBinDir);
    try {
      const result = runCompanion(["task", "--wait", "doomed task"], {
        cwd: tmpDir,
        env: failEnv,
        timeout: 30_000
      });
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes("agy exited with code 1"), `got: ${result.stdout.slice(0, 200)}`);
    } finally {
      removeFakeAgy(failBinDir);
    }
  });
});
