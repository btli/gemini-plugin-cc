import fs from "node:fs";
import path from "node:path";
import { upsertJob, resolveStateDir, writeJobFile } from "./state.mjs";

export const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeProgressEvent(value) {
  if (!value || typeof value !== "object") {
    return { message: String(value ?? "") };
  }
  return {
    message: typeof value.message === "string" ? value.message : "",
    phase: typeof value.phase === "string" ? value.phase : undefined,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    turnId: typeof value.turnId === "string" ? value.turnId : undefined,
    logTitle: typeof value.logTitle === "string" ? value.logTitle : undefined,
    logBody: typeof value.logBody === "string" ? value.logBody : undefined
  };
}

export function appendLogLine(logFile, message) {
  if (!logFile || !message) {
    return;
  }
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, "utf8");
}

export function appendLogBlock(logFile, title, body) {
  if (!logFile || !title) {
    return;
  }
  const timestamp = new Date().toISOString();
  const block = body ? `[${timestamp}] ${title}\n${body}\n` : `[${timestamp}] ${title}\n`;
  fs.appendFileSync(logFile, block, "utf8");
}

export function createJobLogFile(workspaceRoot, jobId, title) {
  const stateDir = resolveStateDir(workspaceRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  const logFile = path.join(stateDir, `job-${jobId}.log`);
  appendLogLine(logFile, `Job ${jobId}: ${title}`);
  return logFile;
}

export function createJobRecord(base, options = {}) {
  const sessionId = options.sessionId ?? process.env[SESSION_ID_ENV] ?? null;
  const now = nowIso();
  return {
    ...base,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    ...(sessionId ? { sessionId } : {})
  };
}

export function createJobProgressUpdater(workspaceRoot, jobId) {
  let lastPhase = null;
  let lastSessionId = null;
  let lastTurnId = null;

  return function updateJobProgress(event) {
    const normalized = normalizeProgressEvent(event);
    const updates = {};
    let changed = false;

    if (normalized.phase && normalized.phase !== lastPhase) {
      updates.phase = normalized.phase;
      lastPhase = normalized.phase;
      changed = true;
    }

    if (normalized.sessionId && normalized.sessionId !== lastSessionId) {
      updates.sessionId = normalized.sessionId;
      lastSessionId = normalized.sessionId;
      changed = true;
    }

    if (normalized.turnId && normalized.turnId !== lastTurnId) {
      updates.turnId = normalized.turnId;
      lastTurnId = normalized.turnId;
      changed = true;
    }

    if (normalized.message) {
      updates.summary = normalized.message;
      changed = true;
    }

    if (changed) {
      upsertJob(workspaceRoot, { id: jobId, ...updates });
    }

    return changed;
  };
}

export function createProgressReporter(options = {}) {
  const { logFile, onProgress, stderr: useStderr = true } = options;

  return function reportProgress(event) {
    const normalized = normalizeProgressEvent(event);

    if (normalized.logTitle) {
      appendLogBlock(logFile, normalized.logTitle, normalized.logBody ?? "");
    } else if (normalized.message) {
      appendLogLine(logFile, normalized.message);
    }

    if (useStderr && normalized.message) {
      process.stderr.write(`${normalized.message}\n`);
    }

    if (onProgress) {
      onProgress(normalized);
    }
  };
}

export async function runTrackedJob(job, runner, options = {}) {
  const { workspaceRoot, logFile } = options;
  const updateProgress = options.updateProgress ?? createJobProgressUpdater(workspaceRoot, job.id);
  const reporter = options.reporter ?? createProgressReporter({ logFile, onProgress: updateProgress });

  upsertJob(workspaceRoot, {
    ...job,
    status: "running",
    startedAt: nowIso()
  });

  try {
    const result = await runner({ reporter, updateProgress });
    const now = nowIso();

    const finalJob = {
      ...job,
      status: "completed",
      completedAt: now,
      phase: "done",
      ...(result?.summary ? { summary: result.summary } : {}),
      ...(result?.sessionId ? { sessionId: result.sessionId } : {})
    };

    upsertJob(workspaceRoot, finalJob);

    if (result) {
      writeJobFile(workspaceRoot, job.id, {
        result: result.result ?? null,
        rendered: result.rendered ?? null,
        sessionId: result.sessionId ?? null,
        errorMessage: null
      });
    }

    appendLogLine(logFile, `Job ${job.id} completed.`);
    return { ok: true, job: finalJob, result };
  } catch (error) {
    const now = nowIso();
    const errorMessage = error instanceof Error ? error.message : String(error);

    const failedJob = {
      ...job,
      status: "failed",
      completedAt: now,
      phase: "failed",
      errorMessage
    };

    upsertJob(workspaceRoot, failedJob);
    writeJobFile(workspaceRoot, job.id, {
      result: null,
      rendered: null,
      sessionId: null,
      errorMessage
    });

    appendLogLine(logFile, `Job ${job.id} failed: ${errorMessage}`);
    return { ok: false, job: failedJob, error };
  }
}
