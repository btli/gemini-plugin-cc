import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createTempDir, cleanTempDir, initGitRepo } from "./helpers.mjs";
import {
  ensureGitRepository,
  getRepoRoot,
  detectDefaultBranch,
  getCurrentBranch,
  resolveReviewTarget,
  getWorkingTreeFileCount
} from "../plugins/gemini/scripts/lib/git.mjs";

let tmpDir;

describe("git", () => {
  beforeEach(() => {
    tmpDir = createTempDir("git-test-");
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    cleanTempDir(tmpDir);
  });

  it("ensureGitRepository returns root", () => {
    const root = ensureGitRepository(tmpDir);
    assert.ok(root.length > 0);
  });

  it("ensureGitRepository throws for non-repo", () => {
    const nonRepo = createTempDir("non-repo-");
    assert.throws(() => ensureGitRepository(nonRepo), /not inside a git repository/i);
    cleanTempDir(nonRepo);
  });

  it("getRepoRoot returns root", () => {
    const root = getRepoRoot(tmpDir);
    assert.ok(fs.existsSync(path.join(root, ".git")));
  });

  it("detectDefaultBranch returns master for test repo", () => {
    const branch = detectDefaultBranch(tmpDir);
    // initGitRepo creates master by default
    assert.ok(["main", "master"].includes(branch));
  });

  it("getCurrentBranch returns current branch", () => {
    const branch = getCurrentBranch(tmpDir);
    assert.ok(["main", "master"].includes(branch));
  });

  it("resolveReviewTarget detects working-tree with changes", () => {
    fs.writeFileSync(path.join(tmpDir, "new-file.txt"), "hello\n");
    const target = resolveReviewTarget(tmpDir);
    assert.equal(target.mode, "working-tree");
  });

  it("getWorkingTreeFileCount counts files", () => {
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a\n");
    fs.writeFileSync(path.join(tmpDir, "b.txt"), "b\n");
    const count = getWorkingTreeFileCount(tmpDir);
    assert.ok(count >= 2);
  });
});
