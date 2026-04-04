import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createTempDir, cleanTempDir, initGitRepo } from "./helpers.mjs";
import { loadState, saveState, upsertJob, listJobs, getConfig, setConfig } from "../plugins/gemini/scripts/lib/state.mjs";

let tmpDir;

describe("state", () => {
  beforeEach(() => {
    tmpDir = createTempDir("state-test-");
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    cleanTempDir(tmpDir);
  });

  it("returns default state for new workspace", () => {
    const state = loadState(tmpDir);
    assert.equal(state.version, 1);
    assert.deepEqual(state.config, {});
    assert.deepEqual(state.jobs, []);
  });

  it("saves and loads state", () => {
    const state = loadState(tmpDir);
    state.config.testKey = "testValue";
    saveState(tmpDir, state);

    const loaded = loadState(tmpDir);
    assert.equal(loaded.config.testKey, "testValue");
  });

  it("upserts new job", () => {
    upsertJob(tmpDir, { id: "job-1", status: "running", kind: "task" });
    const jobs = listJobs(tmpDir);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, "job-1");
    assert.equal(jobs[0].status, "running");
  });

  it("updates existing job", () => {
    upsertJob(tmpDir, { id: "job-1", status: "running" });
    upsertJob(tmpDir, { id: "job-1", status: "completed" });
    const jobs = listJobs(tmpDir);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "completed");
  });

  it("manages config", () => {
    setConfig(tmpDir, "stopReviewGate", true);
    const config = getConfig(tmpDir);
    assert.equal(config.stopReviewGate, true);

    setConfig(tmpDir, "stopReviewGate", false);
    const updated = getConfig(tmpDir);
    assert.equal(updated.stopReviewGate, false);
  });
});
