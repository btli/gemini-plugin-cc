import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./process.mjs";

export const WORKTREE_PREFIX = "agy-review-";
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function git(args, cwd, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}

function realTmpDir() {
  // macOS: os.tmpdir() is /var/... but git reports the /private/var/... realpath.
  try {
    return fs.realpathSync(os.tmpdir());
  } catch {
    return path.resolve(os.tmpdir());
  }
}

/**
 * Copy the workspace's uncommitted state into the worktree (best effort):
 * tracked changes via `git diff HEAD --binary | git apply`, untracked
 * non-ignored files via direct copy. Returns warning strings for anything
 * that could not be mirrored — the review prompt already embeds the diff,
 * so mirroring failures degrade fidelity, not correctness.
 */
export function mirrorWorkingState(workspaceRoot, worktreePath) {
  const warnings = [];

  const diff = git(["diff", "HEAD", "--binary"], workspaceRoot);
  if (diff.status === 0 && diff.stdout.trim()) {
    const apply = git(["apply", "--whitespace=nowarn"], worktreePath, { input: diff.stdout });
    if (apply.status !== 0) {
      warnings.push(
        `could not mirror uncommitted changes: ${(apply.stderr || apply.stdout).trim().slice(0, 200)}`
      );
    }
  } else if (diff.status !== 0) {
    warnings.push(`could not compute working-tree diff: ${(diff.stderr || "").trim().slice(0, 200)}`);
  }

  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], workspaceRoot);
  if (untracked.status === 0 && untracked.stdout) {
    for (const relPath of untracked.stdout.split("\0").filter(Boolean)) {
      try {
        const source = path.join(workspaceRoot, relPath);
        const destination = path.join(worktreePath, relPath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
      } catch {
        warnings.push(`could not copy untracked file: ${relPath}`);
      }
    }
  }

  return warnings;
}

/**
 * Create a disposable detached worktree at HEAD under the OS temp dir and
 * mirror the current working state into it.
 *
 * @param {string} workspaceRoot - git repository root
 * @param {string|null} id - job id for background reviews; random for foreground
 * @returns {{ path: string, warnings: string[], cleanup: () => void }}
 */
export function createReviewWorktree(workspaceRoot, id = null) {
  const worktreeId = id ?? crypto.randomBytes(4).toString("hex");
  const worktreePath = path.join(os.tmpdir(), `${WORKTREE_PREFIX}${worktreeId}`);

  const add = git(["worktree", "add", "--detach", worktreePath, "HEAD"], workspaceRoot);
  if (add.status !== 0) {
    throw new Error(`git worktree add failed: ${(add.stderr || add.stdout).trim().slice(0, 300)}`);
  }

  const warnings = mirrorWorkingState(workspaceRoot, worktreePath);

  function cleanup() {
    const remove = git(["worktree", "remove", "--force", worktreePath], workspaceRoot);
    if (remove.status !== 0) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        // best effort
      }
      git(["worktree", "prune"], workspaceRoot);
    }
  }

  return { path: worktreePath, warnings, cleanup };
}

/**
 * Remove agy-review-* worktrees older than maxAgeMs (default 24h) — covers
 * workers that died without running cleanup (e.g. SIGKILL). Only touches
 * worktrees whose directory sits directly in the OS temp dir AND whose name
 * starts with the agy-review- prefix; never touches user worktrees.
 */
export function sweepOrphanedWorktrees(workspaceRoot, options = {}) {
  const maxAgeMs = options.maxAgeMs ?? ORPHAN_MAX_AGE_MS;
  const tmpRoot = realTmpDir();
  const removed = [];

  const list = git(["worktree", "list", "--porcelain"], workspaceRoot);
  if (list.status !== 0) {
    return removed;
  }

  const worktreePaths = list.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());

  for (const worktreePath of worktreePaths) {
    const isOurs =
      path.basename(worktreePath).startsWith(WORKTREE_PREFIX) &&
      path.dirname(worktreePath) === tmpRoot;
    if (!isOurs) {
      continue;
    }

    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(worktreePath).mtimeMs;
    } catch {
      mtimeMs = 0; // directory already gone — remove the stale registration
    }
    if (Date.now() - mtimeMs < maxAgeMs) {
      continue;
    }

    const remove = git(["worktree", "remove", "--force", worktreePath], workspaceRoot);
    if (remove.status === 0) {
      removed.push(worktreePath);
    }
  }

  git(["worktree", "prune"], workspaceRoot);
  return removed;
}
