#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { readJsonFile } from "./lib/fs.mjs";
import {
  collectReviewContext,
  getReviewDiffStats,
  getWorkingTreeFileCount,
  resolveReviewTarget
} from "./lib/git.mjs";
import {
  getGeminiAvailability,
  getGeminiAuthStatus,
  runGeminiReview,
  runGeminiTask,
  parseStructuredOutput,
  readOutputSchema,
  findLatestTaskSession,
  installShutdownHandler
} from "./lib/gemini.mjs";
import {
  buildStatusSnapshot,
  buildSingleJobSnapshot,
  enrichJob,
  resolveCancelableJob,
  resolveResultJob,
  readStoredJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import { binaryAvailable, isProcessAlive, terminateProcessTree } from "./lib/process.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  renderSetupReport,
  renderReviewResult,
  renderTaskResult,
  renderStatusReport,
  renderJobStatusReport,
  renderStoredJobResult,
  renderCancelReport
} from "./lib/render.mjs";
import { getConfig, setConfig, listJobs, upsertJob, writeJobFile } from "./lib/state.mjs";
import {
  SESSION_ID_ENV,
  nowIso,
  createJobRecord,
  createJobLogFile,
  runTrackedJob
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

function generateJobId() {
  return crypto.randomBytes(4).toString("hex");
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

function handleSetup(cwd, argv) {
  const { options } = parseArgs(argv, {
    booleanOptions: new Set(["json", "enable-review-gate", "disable-review-gate"]),
    aliasMap: {}
  });

  const workspaceRoot = resolveWorkspaceRoot(cwd);

  // Toggle review gate if requested
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  }
  if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }

  const nodeStatus = binaryAvailable("node");
  const npmStatus = binaryAvailable("npm");
  const geminiStatus = getGeminiAvailability(cwd);
  const authStatus = geminiStatus.available ? getGeminiAuthStatus() : { available: false, loggedIn: false, detail: "gemini not installed" };
  const config = getConfig(workspaceRoot);

  const report = {
    ready: geminiStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    npm: npmStatus,
    gemini: geminiStatus,
    auth: authStatus,
    sessionRuntime: { label: "direct" },
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken: [],
    nextSteps: []
  };

  if (!geminiStatus.available && npmStatus.available) {
    report.nextSteps.push("Install Gemini CLI: npm install -g @google/gemini-cli");
  } else if (!geminiStatus.available) {
    report.nextSteps.push("Install Gemini CLI: see https://github.com/google-gemini/gemini-cli");
  }

  if (geminiStatus.available && !authStatus.loggedIn) {
    report.nextSteps.push("Authenticate: run !gemini auth login");
  }

  const output = options.json ? JSON.stringify(report, null, 2) : renderSetupReport(report);
  process.stdout.write(output);
}

// ---------------------------------------------------------------------------
// review / adversarial-review
// ---------------------------------------------------------------------------

function buildReviewPrompt(cwd, target, kind, focusText) {
  const context = collectReviewContext(cwd, target);
  const schemaPath = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
  const schema = readOutputSchema(schemaPath);
  const schemaBlock = schema ? `\n\nReturn your review as JSON matching this schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n` : "";

  const templateName = kind === "adversarial-review" ? "adversarial-review" : "review";
  let template;
  try {
    template = loadPromptTemplate(ROOT_DIR, templateName);
  } catch {
    // Fallback if template not found
    template = kind === "adversarial-review"
      ? "You are performing an adversarial code review. Challenge the implementation choices, design decisions, tradeoffs, and assumptions.\n\n{{REVIEW_CONTEXT}}\n\n{{SCHEMA_BLOCK}}\n\n{{USER_FOCUS}}"
      : "You are performing a thorough code review. Identify bugs, security issues, performance problems, and maintainability concerns.\n\n{{REVIEW_CONTEXT}}\n\n{{SCHEMA_BLOCK}}";
  }

  const targetLabel = target.mode === "branch"
    ? `Branch diff against ${target.base}`
    : "Working tree changes";

  return {
    prompt: interpolateTemplate(template, {
      REVIEW_CONTEXT: context,
      SCHEMA_BLOCK: schemaBlock,
      TARGET_LABEL: targetLabel,
      USER_FOCUS: focusText ? `\nUser focus: ${focusText}` : ""
    }),
    targetLabel
  };
}

async function executeReviewForeground(cwd, target, kind, options = {}) {
  const { prompt, targetLabel } = buildReviewPrompt(cwd, target, kind, options.focusText);
  const reviewLabel = kind === "adversarial-review" ? "Adversarial Review" : "Review";

  const result = await runGeminiReview(cwd, {
    prompt,
    model: options.model,
    timeoutMs: options.timeoutMs,
    env: options.env
  });

  if (!result.ok) {
    const output = renderReviewResult(
      { parsed: null, parseError: result.parseError, rawOutput: result.rawOutput },
      { reviewLabel, targetLabel, reasoningSummary: null }
    );
    process.stdout.write(output);
    return;
  }

  const output = renderReviewResult(
    { parsed: result.parsed, parseError: result.parseError, rawOutput: result.rawOutput },
    { reviewLabel, targetLabel, reasoningSummary: result.reasoningSummary }
  );
  process.stdout.write(output);
}

function executeReviewBackground(cwd, target, kind, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobId = generateJobId();
  const logFile = createJobLogFile(workspaceRoot, jobId, `${kind} review`);

  const job = createJobRecord({
    id: jobId,
    kind,
    jobClass: "review",
    status: "queued",
    title: `${kind} review`,
    logFile,
    write: false
  });

  upsertJob(workspaceRoot, job);

  // Spawn a background worker
  const scriptPath = fileURLToPath(import.meta.url);
  const workerArgs = [
    scriptPath, "review-worker",
    "--job-id", jobId,
    "--kind", kind,
    "--cwd", cwd
  ];

  if (target.mode === "branch") {
    workerArgs.push("--base", target.base);
  }
  if (options.model) {
    workerArgs.push("--model", options.model);
  }
  if (options.focusText) {
    workerArgs.push("--focus", options.focusText);
  }

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, workerArgs, {
    cwd,
    env: {
      ...process.env,
      ...(process.env[SESSION_ID_ENV] ? { [SESSION_ID_ENV]: process.env[SESSION_ID_ENV] } : {})
    },
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);

  upsertJob(workspaceRoot, { id: jobId, pid: child.pid, status: "running", startedAt: nowIso() });

  process.stdout.write(`Started background ${kind}: job ${jobId}\nCheck progress: /gemini:status ${jobId}\nGet result: /gemini:result ${jobId}\n`);
}

async function handleReviewWorker(cwd, argv) {
  installShutdownHandler();

  const { options } = parseArgs(argv, {
    valueOptions: new Set(["job-id", "kind", "cwd", "base", "model", "focus"]),
    booleanOptions: new Set([])
  });

  const jobId = options["job-id"];
  const kind = options.kind ?? "review";
  const workerCwd = options.cwd ?? cwd;
  const workspaceRoot = resolveWorkspaceRoot(workerCwd);
  const target = options.base ? { mode: "branch", base: options.base } : resolveReviewTarget(workerCwd);

  const jobRecord = listJobs(workspaceRoot).find((j) => j.id === jobId);

  const { prompt, targetLabel } = buildReviewPrompt(workerCwd, target, kind, options.focus);
  const reviewLabel = kind === "adversarial-review" ? "Adversarial Review" : "Review";

  const result = await runGeminiReview(workerCwd, {
    prompt,
    model: options.model,
    workspaceRoot,
    logFile: jobRecord?.logFile ?? null,
    jobId
  });

  const rendered = renderReviewResult(
    { parsed: result.parsed, parseError: result.parseError, rawOutput: result.rawOutput },
    { reviewLabel, targetLabel, reasoningSummary: result.reasoningSummary }
  );

  const now = nowIso();
  upsertJob(workspaceRoot, {
    id: jobId,
    status: result.ok ? "completed" : "failed",
    completedAt: now,
    phase: result.ok ? "done" : "failed",
    summary: result.parsed?.summary ?? (result.ok ? "Review completed" : "Review failed"),
    sessionId: result.sessionId
  });

  writeJobFile(workspaceRoot, jobId, {
    result: { parsed: result.parsed, parseError: result.parseError, rawOutput: result.rawOutput },
    rendered,
    sessionId: result.sessionId,
    errorMessage: result.ok ? null : result.parseError
  });
}

async function handleReview(cwd, argv, kind = "review") {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: new Set(["base", "scope", "model", "timeout-ms"]),
    booleanOptions: new Set(["wait", "background", "json"])
  });

  const target = resolveReviewTarget(cwd, { base: options.base, scope: options.scope });
  const focusText = positionals.join(" ").trim() || null;
  const model = options.model ?? null;
  const timeoutMs = options["timeout-ms"] ? Number(options["timeout-ms"]) : undefined;

  if (options.background) {
    executeReviewBackground(cwd, target, kind, { model, focusText });
    return;
  }

  if (options.wait) {
    await executeReviewForeground(cwd, target, kind, { model, focusText, timeoutMs });
    return;
  }

  // Default: estimate scope and recommend
  const diffStats = getReviewDiffStats(cwd, target);
  const fileCount = getWorkingTreeFileCount(cwd);
  const isSmall = fileCount <= 2 && (!diffStats || diffStats.length < 60);

  if (isSmall) {
    await executeReviewForeground(cwd, target, kind, { model, focusText, timeoutMs });
  } else {
    executeReviewBackground(cwd, target, kind, { model, focusText });
  }
}

// ---------------------------------------------------------------------------
// task
// ---------------------------------------------------------------------------

async function handleTask(cwd, argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: new Set(["model", "effort", "timeout-ms"]),
    booleanOptions: new Set(["background", "wait", "write", "read-only", "resume-last", "json"])
  });

  const prompt = positionals.join(" ").trim();
  const write = options["read-only"] ? false : (options.write ?? true);
  const model = options.model ?? null;
  const isBackground = options.background ?? false;

  if (options["resume-last"]) {
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const lastJob = findLatestTaskSession(workspaceRoot, listJobs);
    if (lastJob?.sessionId) {
      return await executeTask(cwd, prompt || "Continue where you left off.", {
        model, write, resume: lastJob.sessionId, background: isBackground
      });
    }
    process.stderr.write("No previous Gemini session found. Starting fresh.\n");
  }

  if (!prompt) {
    process.stderr.write("No task prompt provided.\n");
    process.exitCode = 1;
    return;
  }

  await executeTask(cwd, prompt, { model, write, background: isBackground });
}

async function executeTask(cwd, prompt, options = {}) {
  const { model, write = true, resume, background = false } = options;
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  if (background) {
    const jobId = generateJobId();
    const logFile = createJobLogFile(workspaceRoot, jobId, "task");

    const job = createJobRecord({
      id: jobId,
      kind: "task",
      jobClass: "task",
      status: "queued",
      title: prompt.slice(0, 80),
      logFile,
      write
    });

    upsertJob(workspaceRoot, job);

    const scriptPath = fileURLToPath(import.meta.url);
    const workerArgs = [
      scriptPath, "task-worker",
      "--job-id", jobId,
      "--cwd", cwd,
      "--prompt", prompt
    ];
    if (model) {
      workerArgs.push("--model", model);
    }
    if (!write) {
      workerArgs.push("--read-only");
    }
    if (resume) {
      workerArgs.push("--resume", resume);
    }

    const logFd = fs.openSync(logFile, "a");
    const child = spawn(process.execPath, workerArgs, {
      cwd,
      env: {
        ...process.env,
        ...(process.env[SESSION_ID_ENV] ? { [SESSION_ID_ENV]: process.env[SESSION_ID_ENV] } : {})
      },
      detached: true,
      stdio: ["ignore", logFd, logFd]
    });
    child.unref();
    fs.closeSync(logFd);

    upsertJob(workspaceRoot, { id: jobId, pid: child.pid, status: "running", startedAt: nowIso() });

    process.stdout.write(`Started background task: job ${jobId}\nCheck progress: /gemini:status ${jobId}\nGet result: /gemini:result ${jobId}\n`);
    return;
  }

  // Foreground
  const result = await runGeminiTask(cwd, { prompt, model, write, resume });
  const output = renderTaskResult(result);

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(output);
  }
}

async function handleTaskWorker(cwd, argv) {
  installShutdownHandler();

  const { options } = parseArgs(argv, {
    valueOptions: new Set(["job-id", "cwd", "prompt", "model", "resume"]),
    booleanOptions: new Set(["read-only"])
  });

  const jobId = options["job-id"];
  const workerCwd = options.cwd ?? cwd;
  const workspaceRoot = resolveWorkspaceRoot(workerCwd);
  const write = !options["read-only"];

  const jobRecord = listJobs(workspaceRoot).find((j) => j.id === jobId);

  const result = await runGeminiTask(workerCwd, {
    prompt: options.prompt,
    model: options.model,
    write,
    resume: options.resume,
    jobId,
    workspaceRoot,
    logFile: jobRecord?.logFile ?? null
  });

  const rendered = renderTaskResult(result);
  const now = nowIso();

  upsertJob(workspaceRoot, {
    id: jobId,
    status: result.ok ? "completed" : "failed",
    completedAt: now,
    phase: result.ok ? "done" : "failed",
    summary: result.ok ? "Task completed" : (result.failureMessage ?? "Task failed"),
    sessionId: result.sessionId
  });

  writeJobFile(workspaceRoot, jobId, {
    result: { rawOutput: result.rawOutput },
    rendered,
    sessionId: result.sessionId,
    errorMessage: result.failureMessage
  });
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function handleStatus(cwd, argv) {
  const { options, positionals } = parseArgs(argv, {
    valueOptions: new Set(["timeout-ms"]),
    booleanOptions: new Set(["wait", "all", "json"])
  });

  const reference = positionals[0] ?? null;

  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference, { maxProgressLines: 10 });
    const output = options.json
      ? JSON.stringify(snapshot.job, null, 2)
      : renderJobStatusReport(snapshot.job);
    process.stdout.write(output);
    return;
  }

  const snapshot = buildStatusSnapshot(cwd, { all: options.all });
  const output = options.json
    ? JSON.stringify(snapshot, null, 2)
    : renderStatusReport(snapshot);
  process.stdout.write(output);
}

// ---------------------------------------------------------------------------
// result
// ---------------------------------------------------------------------------

function handleResult(cwd, argv) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: new Set(["json"])
  });

  const reference = positionals[0] ?? null;
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);

  if (options.json) {
    process.stdout.write(JSON.stringify({ job: enrichJob(job), stored: storedJob }, null, 2));
    return;
  }

  const output = renderStoredJobResult(job, storedJob);
  process.stdout.write(output);
}

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

async function handleCancel(cwd, argv) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: new Set(["json"])
  });

  const reference = positionals[0] ?? null;
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);

  if (job.pid) {
    try {
      // Send SIGTERM to just the worker PID (not the process group) so the
      // worker's installShutdownHandler can gracefully cancel the ACP session
      // before the transport dies. On Windows, fall through to terminateProcessTree.
      if (process.platform !== "win32") {
        process.kill(job.pid, "SIGTERM");
        // Give the worker up to 3s to cancel the session, persist results, and exit
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline && isProcessAlive(job.pid)) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      // Fall back to tree kill if the worker is still alive (or on Windows)
      if (isProcessAlive(job.pid)) {
        terminateProcessTree(job.pid);
      }
    } catch {
      // Process may already be gone.
    }
  }

  const now = nowIso();
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    completedAt: now,
    phase: "cancelled"
  });

  if (options.json) {
    process.stdout.write(JSON.stringify({ cancelled: job.id }));
    return;
  }

  const output = renderCancelReport(job);
  process.stdout.write(output);
}

// ---------------------------------------------------------------------------
// main dispatch
// ---------------------------------------------------------------------------

async function main() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case "setup":
      handleSetup(cwd, argv);
      break;
    case "review":
      await handleReview(cwd, argv, "review");
      break;
    case "adversarial-review":
      await handleReview(cwd, argv, "adversarial-review");
      break;
    case "task":
      await handleTask(cwd, argv);
      break;
    case "task-worker":
      await handleTaskWorker(cwd, argv);
      break;
    case "review-worker":
      await handleReviewWorker(cwd, argv);
      break;
    case "status":
      handleStatus(cwd, argv);
      break;
    case "result":
      handleResult(cwd, argv);
      break;
    case "cancel":
      await handleCancel(cwd, argv);
      break;
    default:
      process.stderr.write(`Unknown command: ${command ?? "(none)"}\nUsage: gemini-companion <setup|review|adversarial-review|task|status|result|cancel> [options]\n`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
