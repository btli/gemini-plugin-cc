import fs from "node:fs";
import path from "node:path";
import { runCommand, runCommandChecked } from "./process.mjs";
import { isProbablyText } from "./fs.mjs";

function git(args, options = {}) {
  return runCommand("git", args, options);
}

function gitChecked(args, options = {}) {
  return runCommandChecked("git", args, options);
}

export function ensureGitRepository(cwd) {
  const gitCheck = git(["rev-parse", "--show-toplevel"], { cwd });
  if (gitCheck.error?.code === "ENOENT") {
    throw new Error("git is not installed.");
  }
  if (gitCheck.status !== 0) {
    throw new Error("Not inside a git repository.");
  }
  return gitCheck.stdout.trim();
}

export function getRepoRoot(cwd) {
  return gitChecked(["rev-parse", "--show-toplevel"], { cwd }).stdout.trim();
}

export function detectDefaultBranch(cwd) {
  for (const candidate of ["main", "master", "trunk"]) {
    const check = git(["rev-parse", "--verify", `refs/heads/${candidate}`], { cwd });
    if (check.status === 0) {
      return candidate;
    }
  }
  const symbolic = git(["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd });
  if (symbolic.status === 0) {
    const ref = symbolic.stdout.trim();
    const match = ref.match(/refs\/remotes\/origin\/(.+)/);
    if (match) {
      return match[1];
    }
  }
  return "main";
}

export function getCurrentBranch(cwd) {
  const result = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (result.status !== 0) {
    return null;
  }
  const branch = result.stdout.trim();
  return branch === "HEAD" ? null : branch;
}

export function resolveReviewTarget(cwd, options = {}) {
  const explicitBase = options.base ?? null;
  const explicitScope = options.scope ?? "auto";

  if (explicitBase) {
    return { mode: "branch", base: explicitBase };
  }

  if (explicitScope === "working-tree") {
    return { mode: "working-tree" };
  }

  if (explicitScope === "branch") {
    const base = detectDefaultBranch(cwd);
    return { mode: "branch", base };
  }

  const statusResult = git(["status", "--porcelain"], { cwd });
  const hasChanges = statusResult.status === 0 && statusResult.stdout.trim().length > 0;
  if (hasChanges) {
    return { mode: "working-tree" };
  }

  const currentBranch = getCurrentBranch(cwd);
  const defaultBranch = detectDefaultBranch(cwd);
  if (currentBranch && currentBranch !== defaultBranch) {
    return { mode: "branch", base: defaultBranch };
  }

  return { mode: "working-tree" };
}

const MAX_FILE_SIZE = 24 * 1024;

function safeReadFileContent(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return `[file too large: ${stat.size} bytes]`;
    }
    const buffer = fs.readFileSync(filePath);
    if (!isProbablyText(buffer)) {
      return "[binary file]";
    }
    return buffer.toString("utf8");
  } catch {
    return "[unreadable]";
  }
}

function formatSection(title, content) {
  if (!content || !content.trim()) {
    return "";
  }
  return `## ${title}\n\n${content.trim()}\n`;
}

export function collectWorkingTreeContext(cwd) {
  const sections = [];

  const statusResult = git(["status", "--short", "--untracked-files=all"], { cwd });
  if (statusResult.status === 0 && statusResult.stdout.trim()) {
    sections.push(formatSection("Working tree status", statusResult.stdout));
  }

  const stagedDiff = git(["diff", "--cached"], { cwd });
  if (stagedDiff.status === 0 && stagedDiff.stdout.trim()) {
    sections.push(formatSection("Staged changes", stagedDiff.stdout));
  }

  const unstagedDiff = git(["diff"], { cwd });
  if (unstagedDiff.status === 0 && unstagedDiff.stdout.trim()) {
    sections.push(formatSection("Unstaged changes", unstagedDiff.stdout));
  }

  const untrackedResult = git(["ls-files", "--others", "--exclude-standard"], { cwd });
  if (untrackedResult.status === 0 && untrackedResult.stdout.trim()) {
    const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);
    const untrackedContents = untrackedFiles
      .slice(0, 20)
      .map((file) => {
        const fullPath = path.join(cwd, file);
        const content = safeReadFileContent(fullPath);
        return `### ${file}\n\n\`\`\`\n${content}\n\`\`\``;
      })
      .join("\n\n");
    if (untrackedContents) {
      sections.push(formatSection("Untracked files", untrackedContents));
    }
  }

  return sections.join("\n");
}

export function collectBranchContext(cwd, base) {
  const sections = [];

  const logResult = git(["log", "--oneline", `${base}..HEAD`], { cwd });
  if (logResult.status === 0 && logResult.stdout.trim()) {
    sections.push(formatSection("Commits", logResult.stdout));
  }

  const diffResult = git(["diff", `${base}...HEAD`], { cwd });
  if (diffResult.status === 0 && diffResult.stdout.trim()) {
    sections.push(formatSection("Diff", diffResult.stdout));
  }

  return sections.join("\n");
}

export function collectReviewContext(cwd, target) {
  const sections = [];

  const repoRoot = getRepoRoot(cwd);
  const currentBranch = getCurrentBranch(cwd) ?? "HEAD";
  sections.push(formatSection("Repository", `Root: ${repoRoot}\nBranch: ${currentBranch}`));

  if (target.mode === "branch") {
    sections.push(collectBranchContext(cwd, target.base));
    sections.push(formatSection("Review target", `Branch diff against ${target.base}`));
  } else {
    sections.push(collectWorkingTreeContext(cwd));
    sections.push(formatSection("Review target", "Working tree changes"));
  }

  return sections.join("\n");
}

export function getReviewDiffStats(cwd, target) {
  if (target.mode === "branch") {
    const result = git(["diff", "--shortstat", `${target.base}...HEAD`], { cwd });
    return result.status === 0 ? result.stdout.trim() : "";
  }
  const result = git(["diff", "--shortstat"], { cwd });
  const staged = git(["diff", "--cached", "--shortstat"], { cwd });
  const parts = [result.stdout.trim(), staged.stdout.trim()].filter(Boolean);
  return parts.join("; ");
}

export function getWorkingTreeFileCount(cwd) {
  const status = git(["status", "--short", "--untracked-files=all"], { cwd });
  if (status.status !== 0) {
    return 0;
  }
  return status.stdout.trim().split("\n").filter(Boolean).length;
}
