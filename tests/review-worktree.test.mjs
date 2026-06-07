import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createTempDir, cleanTempDir, initGitRepo, writeFile } from "./helpers.mjs";
import {
  createReviewWorktree,
  sweepOrphanedWorktrees,
  WORKTREE_PREFIX
} from "../plugins/antigravity/scripts/lib/review-worktree.mjs";

let repoDir;

function gitListWorktrees(cwd) {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  return result.stdout ?? "";
}

describe("createReviewWorktree", () => {
  beforeEach(() => {
    repoDir = createTempDir("worktree-test-");
    initGitRepo(repoDir);
  });

  afterEach(() => {
    sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
    cleanTempDir(repoDir);
  });

  it("creates a detached worktree containing committed files", () => {
    const worktree = createReviewWorktree(repoDir, "plantest1");
    try {
      assert.ok(fs.existsSync(path.join(worktree.path, "README.md")));
      assert.ok(path.basename(worktree.path).startsWith(WORKTREE_PREFIX));
    } finally {
      worktree.cleanup();
    }
  });

  it("mirrors modified tracked files into the worktree", () => {
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Modified\n");
    const worktree = createReviewWorktree(repoDir, "plantest2");
    try {
      assert.equal(fs.readFileSync(path.join(worktree.path, "README.md"), "utf8"), "# Modified\n");
      assert.deepEqual(worktree.warnings, []);
    } finally {
      worktree.cleanup();
    }
  });

  it("mirrors untracked files into the worktree", () => {
    writeFile(repoDir, "new-file.txt", "untracked content\n");
    const worktree = createReviewWorktree(repoDir, "plantest3");
    try {
      assert.equal(fs.readFileSync(path.join(worktree.path, "new-file.txt"), "utf8"), "untracked content\n");
    } finally {
      worktree.cleanup();
    }
  });

  it("cleanup removes the worktree directory and registration", () => {
    const worktree = createReviewWorktree(repoDir, "plantest4");
    worktree.cleanup();
    assert.equal(fs.existsSync(worktree.path), false);
    assert.ok(!gitListWorktrees(repoDir).includes(path.basename(worktree.path)));
  });

  it("throws for non-git directories", () => {
    const plainDir = createTempDir("not-a-repo-");
    try {
      assert.throws(() => createReviewWorktree(plainDir, "plantest5"), /worktree add failed/);
    } finally {
      cleanTempDir(plainDir);
    }
  });
});

describe("sweepOrphanedWorktrees", () => {
  beforeEach(() => {
    repoDir = createTempDir("sweep-test-");
    initGitRepo(repoDir);
  });

  afterEach(() => {
    sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
    cleanTempDir(repoDir);
  });

  it("removes aged agy-review worktrees", () => {
    const aged = createReviewWorktree(repoDir, "agedplan1");
    const removed = sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
    assert.ok(removed.some((p) => p.includes("agedplan1")));
    assert.equal(fs.existsSync(aged.path), false);
  });

  it("keeps fresh agy-review worktrees", () => {
    const fresh = createReviewWorktree(repoDir, "freshplan1");
    try {
      const removed = sweepOrphanedWorktrees(repoDir, { maxAgeMs: 60_000 });
      assert.ok(!removed.some((p) => p.includes("freshplan1")));
      assert.ok(fs.existsSync(fresh.path));
    } finally {
      fresh.cleanup();
    }
  });

  it("does not touch worktrees without the agy-review prefix", () => {
    const unrelatedPath = path.join(os.tmpdir(), `regular-wt-${process.pid}-${Date.now()}`);
    const add = spawnSync("git", ["worktree", "add", "--detach", unrelatedPath, "HEAD"], {
      cwd: repoDir,
      encoding: "utf8"
    });
    assert.equal(add.status, 0, add.stderr);
    try {
      sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
      assert.ok(fs.existsSync(unrelatedPath));
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", unrelatedPath], { cwd: repoDir });
    }
  });
});
