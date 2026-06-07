import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runAgyPrint,
  killActiveAgyChild,
  parseAgyLog,
  readAgyLog,
  DEFAULT_PRINT_TIMEOUT_MS
} from "./agy-cli.mjs";
import { createReviewWorktree, sweepOrphanedWorktrees } from "./review-worktree.mjs";
import { DEFAULT_MODEL, resolveModel, suggestAlternatives } from "./models.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";
import { createTempDir, readJsonFile } from "./fs.mjs";
import { appendLogBlock, appendLogLine } from "./tracked-jobs.mjs";
import { upsertJob } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

// ---------------------------------------------------------------------------
// Shutdown handling (SIGTERM-based cancellation)
// ---------------------------------------------------------------------------

/**
 * Install a SIGTERM/SIGINT handler for background workers. /cancel SIGTERMs
 * the worker PID; this handler SIGTERMs the active agy subprocess, which does
 * its own graceful conversation cleanup. The in-flight runAgyPrint then
 * resolves through its normal close path, so the worker persists partial
 * output before exiting naturally.
 */
export function installShutdownHandler() {
  let shuttingDown = false;

  const handler = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const killed = killActiveAgyChild("SIGTERM");
    if (!killed) {
      // No active agy run — exit directly.
      // Exiting here (no active agy child) bypasses any in-flight finally blocks,
      // e.g. review worktree cleanup during creation/mirroring. That orphan is
      // bounded: sweepOrphanedWorktrees reclaims it on the next review (24h gate).
      process.exit(143);
    }
  };

  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
  return handler;
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

export function getAntigravityAvailability(cwd) {
  return binaryAvailable("agy", ["--version"], { cwd });
}

export function getAntigravityAuthStatus() {
  const geminiDir = path.join(os.homedir(), ".gemini");
  for (const marker of ["oauth_creds.json", "google_accounts.json"]) {
    if (fs.existsSync(path.join(geminiDir, marker))) {
      return { available: true, loggedIn: true, detail: "authenticated (Google account)" };
    }
  }
  return {
    available: true,
    loggedIn: false,
    detail: "not authenticated. Run agy interactively once and complete sign-in"
  };
}

// ---------------------------------------------------------------------------
// Structured output parser (3-strategy: direct → fence → brace) — unchanged
// ---------------------------------------------------------------------------

export function parseStructuredOutput(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return { parsed: null, parseError: "Empty response text", rawOutput: "" };
  }

  try {
    const data = JSON.parse(text);
    return { parsed: data, parseError: null, rawOutput: text };
  } catch {
    // continue
  }

  const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1].trim());
      return { parsed: data, parseError: null, rawOutput: text };
    } catch {
      // continue
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const data = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      return { parsed: data, parseError: null, rawOutput: text };
    } catch {
      // fall through
    }
  }

  return {
    parsed: null,
    parseError: "Could not extract JSON from Antigravity response",
    rawOutput: text
  };
}

export function readOutputSchema(schemaPath) {
  try {
    return readJsonFile(schemaPath);
  } catch {
    return null;
  }
}

export function findLatestTaskSession(workspaceRoot, listJobs) {
  const jobs = listJobs(workspaceRoot);
  const taskJobs = jobs
    .filter((job) => job.jobClass === "task" && job.sessionId)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  return taskJobs[0] ?? null;
}

// ---------------------------------------------------------------------------
// Output post-processing helpers
// ---------------------------------------------------------------------------

/**
 * Strip an absolute path prefix (e.g. the review worktree) from model output
 * so findings reference repo-relative paths. Handles the macOS
 * /var ↔ /private/var symlink in both directions.
 */
export function stripPathPrefix(text, prefix) {
  if (!text || !prefix) {
    return text ?? "";
  }
  const variantSet = new Set([prefix]);
  if (prefix.startsWith("/private/")) {
    variantSet.add(prefix.slice("/private".length));
  } else if (prefix.startsWith("/")) {
    variantSet.add(`/private${prefix}`);
  }

  // Process longest variants first so shorter ones that are substrings of longer
  // ones (e.g. /var/... inside /private/var/...) don't corrupt the string first.
  const variants = [...variantSet].sort((a, b) => b.length - a.length);

  let result = text;
  for (const variant of variants) {
    result = result.split(`${variant}/`).join("");
    result = result.split(variant).join(".");
  }
  return result;
}

function captureGitStatus(cwd) {
  const status = runCommand("git", ["status", "--porcelain"], { cwd });
  return status.status === 0 ? status.stdout : null;
}

/** Lines present in `after` but not in `before` (both `git status --porcelain`). */
export function detectWorkingTreeDelta(before, after) {
  if (before == null || after == null || before === after) {
    return [];
  }
  const beforeLines = new Set(before.split("\n").filter(Boolean));
  return after.split("\n").filter(Boolean).filter((line) => !beforeLines.has(line));
}

// ---------------------------------------------------------------------------
// Task execution (agy print mode)
// ---------------------------------------------------------------------------

const READ_ONLY_GUARD =
  "IMPORTANT: You are running in READ-ONLY mode. Do not create, modify, or delete any files, " +
  "and do not run commands that change repository or system state. If a change would be needed, describe it instead.";

const RATE_LIMIT_RE = /429|RESOURCE_EXHAUSTED|capacity|rate.?limit/i;
const AUTH_FAILURE_RE = /not logged in|authentication failed/i;

const CONVERSATION_WATCH_INTERVAL_MS = 500;

/**
 * Poll the agy log for the conversation id while the run is in flight, so a
 * hard-killed worker still leaves a resumable id in job state (matching the
 * previous backend's persist-immediately behavior).
 */
function watchConversationId(agyLogFile, onFound) {
  if (!agyLogFile) {
    return () => {};
  }
  let stopped = false;
  const timer = setInterval(() => {
    const { conversationId } = parseAgyLog(readAgyLog(agyLogFile));
    if (conversationId) {
      stop();
      onFound(conversationId);
    }
  }, CONVERSATION_WATCH_INTERVAL_MS);
  timer.unref?.();

  function stop() {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
    }
  }
  return stop;
}

/**
 * Run an Antigravity task via agy print mode.
 *
 * @param {string} cwd - working directory for agy
 * @param {object} options
 * @param {string}  options.prompt
 * @param {string}  [options.model]    - alias or agy display label
 * @param {boolean} [options.write=true]
 * @param {string}  [options.resume]   - existing conversation id to resume
 * @param {string}  [options.logFile]
 * @param {Function} [options.onProgress]
 * @param {object}  [options.env]
 * @param {string}  [options.jobId]
 * @param {string}  [options.workspaceRoot]
 * @param {number}  [options.timeoutMs]
 * @param {boolean} [options.skipWriteDetection] - internal: review path is already isolated
 * @param {string}  [options.binary]   - test override for the agy binary
 * @returns {Promise<{ok: boolean, rawOutput: string, sessionId: string|null, stopReason: string|null, failureMessage: string|null}>}
 */
export async function runAntigravityTask(cwd, options = {}) {
  const {
    prompt,
    model,
    write = true,
    resume,
    logFile,
    onProgress,
    env,
    jobId,
    workspaceRoot,
    timeoutMs,
    skipWriteDetection = false,
    binary
  } = options;

  const resolvedModel = resolveModel(model) ?? DEFAULT_MODEL;
  const effectiveWorkspaceRoot = workspaceRoot ?? resolveWorkspaceRoot(cwd);
  const agyLogFile = logFile
    ? `${logFile}.agy.log`
    : path.join(os.tmpdir(), `agy-print-${process.pid}-${Date.now()}.log`); // foreground runs leave this small glog in tmp; OS tmp-cleaning reclaims it

  // Non-git cwd → captureGitStatus returns null and write-detection is skipped (no baseline).
  const preStatus = !write && !skipWriteDetection ? captureGitStatus(cwd) : null;
  const effectivePrompt = write ? prompt : `${READ_ONLY_GUARD}\n\n${prompt}`;

  appendLogLine(logFile, resume ? `Resuming agy conversation ${resume}` : `Starting agy (${resolvedModel})`);
  onProgress?.({ message: "agy running...", phase: "running" });

  function persistConversationId(conversationId) {
    if (jobId && effectiveWorkspaceRoot) {
      try {
        upsertJob(effectiveWorkspaceRoot, { id: jobId, sessionId: conversationId });
      } catch {
        // non-fatal — state write may fail in edge cases
      }
    }
  }

  const stopWatching = watchConversationId(agyLogFile, persistConversationId);

  let run;
  try {
    run = await runAgyPrint({
      prompt: effectivePrompt,
      modelLabel: resolvedModel,
      conversationId: resume,
      cwd,
      env,
      agyLogFile,
      timeoutMs: timeoutMs ?? DEFAULT_PRINT_TIMEOUT_MS,
      skipPermissions: write,
      ...(binary ? { binary } : {})
    });
  } finally {
    stopWatching();
  }

  if (run.stdout) {
    appendLogBlock(logFile, "Final output", run.stdout);
  }
  if (run.conversationId) {
    persistConversationId(run.conversationId);
  }

  if (run.spawnErrorMessage) {
    return {
      ok: false,
      rawOutput: "",
      sessionId: null,
      stopReason: "error",
      failureMessage: `Failed to start agy: ${run.spawnErrorMessage}`
    };
  }

  if (run.timedOut) {
    const seconds = Math.round((timeoutMs ?? DEFAULT_PRINT_TIMEOUT_MS) / 1000);
    return {
      ok: false,
      rawOutput: run.stdout,
      sessionId: run.conversationId,
      stopReason: "timeout",
      failureMessage: `agy timed out after ${seconds}s.`
    };
  }

  if (run.modelFellBack) {
    const alternatives = suggestAlternatives(run.resolvedModelLabel);
    const suggestion = alternatives.length > 0 ? ` Try: --model ${alternatives[0]}` : "";
    const requestedNote = model && resolveModel(model) !== model ? ` (requested via "${model}")` : "";
    return {
      ok: false,
      rawOutput: run.stdout,
      sessionId: run.conversationId,
      stopReason: "error",
      failureMessage: `Model "${resolvedModel}" is unavailable in this agy build${requestedNote}; it fell back to "${run.resolvedModelLabel}".${suggestion}`
    };
  }

  if (run.exitCode !== 0) {
    const haystack = `${run.stderr}\n${readAgyLog(agyLogFile).slice(-4096)}`;
    let failureMessage;
    if (RATE_LIMIT_RE.test(haystack)) {
      const alternatives = suggestAlternatives(resolvedModel);
      const suggestion = alternatives.length > 0 ? ` Try: --model ${alternatives[0]}` : "";
      failureMessage = `Model "${resolvedModel}" hit rate limits.${suggestion}`;
    } else if (AUTH_FAILURE_RE.test(haystack)) {
      failureMessage = "agy is not authenticated. Run agy interactively once and complete sign-in.";
    } else {
      const detail = run.stderr.trim().slice(0, 500);
      failureMessage = detail
        ? `agy exited with code ${run.exitCode}: ${detail}`
        : `agy exited with code ${run.exitCode}.`;
    }
    return {
      ok: false,
      rawOutput: run.stdout,
      sessionId: run.conversationId,
      stopReason: "error",
      failureMessage
    };
  }

  let rawOutput = run.stdout;

  if (preStatus != null) {
    const delta = detectWorkingTreeDelta(preStatus, captureGitStatus(cwd));
    if (delta.length > 0) {
      const warning = [
        "WARNING: this read-only task modified the working tree:",
        ...delta.map((line) => `  ${line}`),
        "Review these changes with `git status` / `git diff` and revert anything unwanted.",
        ""
      ].join("\n");
      rawOutput = `${warning}\n${rawOutput}`;
      appendLogLine(logFile, `read-only violation: ${delta.length} path(s) changed`);
    }
  }

  return {
    ok: true,
    rawOutput,
    sessionId: run.conversationId,
    stopReason: "end_turn",
    failureMessage: null
  };
}

// ---------------------------------------------------------------------------
// Review execution (worktree-isolated)
// ---------------------------------------------------------------------------

/**
 * Run an Antigravity review. The review context is fully embedded in the
 * prompt; agy executes inside a disposable git worktree mirroring the working
 * state, so the model can read repo files while stray writes land in the
 * throwaway worktree.
 *
 * @returns {Promise<{ok: boolean, parsed: object|null, parseError: string|null, rawOutput: string, sessionId: string|null, reasoningSummary: string|null}>}
 */
export async function runAntigravityReview(cwd, options = {}) {
  const { prompt, model, timeoutMs, logFile, onProgress, env, workspaceRoot, jobId, binary } = options;
  const effectiveWorkspaceRoot = workspaceRoot ?? resolveWorkspaceRoot(cwd);

  try {
    sweepOrphanedWorktrees(effectiveWorkspaceRoot);
  } catch {
    // best-effort housekeeping
  }

  let isolation = null;
  let isolationNote = null;
  try {
    isolation = createReviewWorktree(effectiveWorkspaceRoot, jobId ?? null);
    for (const warning of isolation.warnings) {
      appendLogLine(logFile, `worktree: ${warning}`);
    }
  } catch (err) {
    appendLogLine(logFile, `worktree creation failed: ${err.message}`);
    isolationNote =
      "Note: the reviewer had no repository file access (worktree creation failed); findings are based on the embedded diff context only.";
  }

  const execCwd = isolation ? isolation.path : createTempDir("agy-review-");

  let taskResult;
  try {
    taskResult = await runAntigravityTask(execCwd, {
      prompt,
      model,
      write: false,
      skipWriteDetection: true,
      logFile,
      onProgress,
      env,
      workspaceRoot: effectiveWorkspaceRoot,
      timeoutMs,
      jobId,
      ...(binary ? { binary } : {})
    });
  } finally {
    if (isolation) {
      isolation.cleanup();
    } else {
      try {
        fs.rmSync(execCwd, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }

  const rawOutput = stripPathPrefix(taskResult.rawOutput, execCwd);

  if (!taskResult.ok) {
    return {
      ok: false,
      parsed: null,
      parseError: taskResult.failureMessage,
      rawOutput,
      sessionId: taskResult.sessionId,
      reasoningSummary: null
    };
  }

  const structured = parseStructuredOutput(rawOutput);
  if (isolationNote) {
    if (structured.parsed && typeof structured.parsed.summary === "string") {
      structured.parsed.summary = `${isolationNote} ${structured.parsed.summary}`;
    } else {
      structured.rawOutput = `${isolationNote}\n\n${structured.rawOutput}`;
    }
  }

  return {
    ok: true,
    ...structured,
    sessionId: taskResult.sessionId,
    reasoningSummary: null
  };
}
