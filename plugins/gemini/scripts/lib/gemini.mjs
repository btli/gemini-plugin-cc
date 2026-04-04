import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, resumeSession, withTimeout } from "./acp-lifecycle.mjs";
import { resolveModel, suggestAlternatives } from "./models.mjs";
import { binaryAvailable } from "./process.mjs";
import { readJsonFile } from "./fs.mjs";
import { appendLogLine, createBufferedLogWriter } from "./tracked-jobs.mjs";
import { upsertJob } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

// ---------------------------------------------------------------------------
// Module-level active task tracking (for SIGTERM-based cancellation)
// ---------------------------------------------------------------------------

let _activeTask = null;

/**
 * Install a SIGTERM/SIGINT handler that gracefully cancels the active ACP session.
 * Call this in background worker processes so that `handleCancel` (which sends
 * SIGTERM to the worker PID) triggers a clean session/cancel on the live
 * connection instead of requiring a separate ACP client.
 *
 * When a task is active, the handler sends session/cancel and closes the client.
 * Closing the client rejects the pending session/prompt promise, which lets
 * runGeminiTask flow through its normal catch path — preserving partial output
 * and allowing the worker to persist results before exiting naturally.
 */
export function installShutdownHandler() {
  let shuttingDown = false;

  const handler = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (_activeTask) {
      const { client, sessionId } = _activeTask;
      try {
        client.notify("session/cancel", { sessionId });
      } catch {
        // best-effort
      }
      // Close the client — this rejects pending requests, causing runGeminiTask's
      // catch to fire. The worker's normal completion path then persists results.
      // Do NOT call process.exit() here; let the normal flow complete.
      await client.close().catch(() => {});
    } else {
      // No active task — exit directly
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

export function getGeminiAvailability(cwd) {
  return binaryAvailable("gemini", ["--version"], { cwd });
}

export function getGeminiAuthStatus() {
  const geminiDir = path.join(os.homedir(), ".gemini");
  const oauthPath = path.join(geminiDir, "oauth_creds.json");
  const credsPath = path.join(geminiDir, "gemini-credentials.json");
  const settingsPath = path.join(geminiDir, "settings.json");

  const hasOauth = fs.existsSync(oauthPath);
  const hasCreds = fs.existsSync(credsPath);

  // Also check for API key in settings
  let hasApiKey = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = readJsonFile(settingsPath);
      hasApiKey = Boolean(settings?.apiKey || settings?.["api-key"]);
    } catch {
      // ignore
    }
  }

  // Check GEMINI_API_KEY env
  const hasEnvKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  if (hasOauth) {
    return { available: true, loggedIn: true, detail: "authenticated (Google OAuth)" };
  }
  if (hasCreds) {
    return { available: true, loggedIn: true, detail: "authenticated (credentials)" };
  }
  if (hasApiKey || hasEnvKey) {
    return { available: true, loggedIn: true, detail: "authenticated (API key)" };
  }

  return {
    available: true,
    loggedIn: false,
    detail: "not authenticated. Run: gemini auth login"
  };
}

// ---------------------------------------------------------------------------
// Structured output parser (3-strategy: direct → fence → brace)
// ---------------------------------------------------------------------------

export function parseStructuredOutput(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return { parsed: null, parseError: "Empty response text", rawOutput: "" };
  }

  // Try direct JSON parse
  try {
    const data = JSON.parse(text);
    return { parsed: data, parseError: null, rawOutput: text };
  } catch {
    // continue
  }

  // Try extracting JSON from markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1].trim());
      return { parsed: data, parseError: null, rawOutput: text };
    } catch {
      // continue
    }
  }

  // Try finding JSON object in the text
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
    parseError: "Could not extract JSON from Gemini response",
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
// Async ACP-based task execution
// ---------------------------------------------------------------------------

function buildModelFailureResult(sessionId, model, resolvedModel, message, partialOutput = "") {
  const alternatives = suggestAlternatives(resolvedModel);
  const suggestion = alternatives.length > 0 ? ` Try: --model ${alternatives[0]}` : "";
  return {
    ok: false,
    rawOutput: partialOutput,
    sessionId,
    stopReason: null,
    failureMessage: `${message}${suggestion}`
  };
}

const DEFAULT_PROMPT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes, same as old spawnSync default

/**
 * Run a Gemini task via ACP.
 *
 * @param {string} cwd - working directory
 * @param {object} options
 * @param {string}  options.prompt
 * @param {string}  [options.model]
 * @param {boolean} [options.write=true]
 * @param {string}  [options.resume]       - existing sessionId to resume
 * @param {string}  [options.logFile]
 * @param {Function} [options.onProgress]
 * @param {object}  [options.env]
 * @param {string}  [options.jobId]
 * @param {string}  [options.workspaceRoot]
 * @param {number}  [options.timeoutMs]
 * @returns {Promise<{ok: boolean, rawOutput: string, sessionId: string|null, stopReason: string|null, failureMessage: string|null}>}
 */
export async function runGeminiTask(cwd, options = {}) {
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
    timeoutMs
  } = options;

  const resolvedModel = resolveModel(model);
  const modeId = write ? "default" : "plan";
  const effectiveWorkspaceRoot = workspaceRoot ?? resolveWorkspaceRoot(cwd);

  let client, sessionId;
  try {
    if (resume) {
      ({ client, sessionId } = await resumeSession(resume, {
        cwd, env, workspaceRoot: effectiveWorkspaceRoot, write, logFile,
        modeId, model: resolvedModel
      }));
    } else {
      ({ client, sessionId } = await createSession({
        cwd, env, modeId, model: resolvedModel,
        workspaceRoot: effectiveWorkspaceRoot, write, logFile
      }));
    }
  } catch (err) {
    return {
      ok: false,
      rawOutput: "",
      sessionId: null,
      stopReason: null,
      failureMessage: err.message
    };
  }

  // Track active task for SIGTERM-based cancellation
  _activeTask = { client, sessionId };

  // Persist sessionId immediately for graceful cancel support
  if (jobId && effectiveWorkspaceRoot) {
    try {
      upsertJob(effectiveWorkspaceRoot, { id: jobId, sessionId });
    } catch {
      // non-fatal — state write may fail in edge cases
    }
  }

  const chunks = [];
  const logWriter = createBufferedLogWriter(logFile);

  client.setNotificationHandler((message) => {
    if (message.method !== "session/update") {
      return;
    }
    const params = message.params;
    if (params?.sessionId !== sessionId) {
      return;
    }
    const update = params?.update;
    if (!update) {
      return;
    }

    if (update.sessionUpdate === "agent_message_chunk" && update.content?.text) {
      chunks.push(update.content.text);
      logWriter.write(update.content.text);
      onProgress?.({ message: update.content.text, phase: "streaming" });
    } else if (update.sessionUpdate === "tool_call") {
      logWriter.flush();
      const toolName = update.name ?? "tool";
      appendLogLine(logFile, `[tool_call] ${toolName}`);
      onProgress?.({ message: `Running: ${toolName}`, phase: "tool_call" });
    }
  });

  const promptTimeoutMs = timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;

  let result;
  try {
    result = await withTimeout(
      client.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: prompt }]
      }),
      promptTimeoutMs, "Gemini prompt"
    );
  } catch (err) {
    logWriter.flush();
    // On timeout, try graceful cancel before closing
    try { client.notify("session/cancel", { sessionId }); } catch {}
    await client.close().catch(() => {});
    _activeTask = null;
    const msg = err?.message ?? String(err);
    const partialOutput = chunks.join("");

    if (/429|RESOURCE_EXHAUSTED|capacity|rate.limit/i.test(msg)) {
      return buildModelFailureResult(sessionId, model, resolvedModel, `Model "${model ?? "default"}" hit rate limits.`, partialOutput);
    }
    if (/malformed function call/i.test(msg)) {
      return buildModelFailureResult(sessionId, model, resolvedModel, `Model "${model ?? "default"}" returned malformed output.`, partialOutput);
    }
    return {
      ok: false,
      rawOutput: partialOutput,
      sessionId,
      stopReason: null,
      failureMessage: msg
    };
  }

  logWriter.flush();
  await client.close().catch(() => {});
  _activeTask = null;

  const stopReason = result?.stopReason ?? "unknown";
  const isSuccess = stopReason === "end_turn";

  return {
    ok: isSuccess,
    rawOutput: chunks.join(""),
    sessionId,
    stopReason,
    failureMessage: isSuccess ? null : `Gemini turn ended with stop reason: ${stopReason}`
  };
}

// ---------------------------------------------------------------------------
// Async ACP-based review execution
// ---------------------------------------------------------------------------

/**
 * Run a Gemini review via ACP (read-only mode).
 *
 * @param {string} cwd - working directory
 * @param {object} options
 * @param {string}  options.prompt
 * @param {string}  [options.model]
 * @param {number}  [options.timeoutMs]
 * @param {string}  [options.logFile]
 * @param {Function} [options.onProgress]
 * @param {object}  [options.env]
 * @param {string}  [options.workspaceRoot]
 * @returns {Promise<{ok: boolean, parsed: object|null, parseError: string|null, rawOutput: string, sessionId: string|null, reasoningSummary: string|null}>}
 */
export async function runGeminiReview(cwd, options = {}) {
  const {
    prompt,
    model,
    timeoutMs,
    logFile,
    onProgress,
    env,
    workspaceRoot,
    jobId
  } = options;

  // Reviews are always read-only (write: false)
  const taskResult = await runGeminiTask(cwd, {
    prompt, model, write: false, logFile, onProgress, env, workspaceRoot,
    timeoutMs, jobId
  });

  if (!taskResult.ok) {
    return {
      ok: false,
      parsed: null,
      parseError: taskResult.failureMessage,
      rawOutput: taskResult.rawOutput,
      sessionId: taskResult.sessionId,
      reasoningSummary: null
    };
  }

  const structuredResult = parseStructuredOutput(taskResult.rawOutput);

  return {
    ok: true,
    ...structuredResult,
    sessionId: taskResult.sessionId,
    reasoningSummary: null
  };
}

// ---------------------------------------------------------------------------
// Session interruption
// ---------------------------------------------------------------------------

/**
 * Interrupt / cancel a running ACP session.
 *
 * Cancellation is handled via SIGTERM: the background worker process traps
 * SIGTERM (via installShutdownHandler) and sends session/cancel on its own
 * active ACP connection. Callers should use terminateProcessTree(pid) on the
 * worker PID instead of calling this function.
 *
 * This function is kept as a no-op for backward compatibility but does nothing
 * useful — a fresh ACP client cannot reach another process's session.
 *
 * @deprecated Use terminateProcessTree on the worker PID instead.
 */
export async function interruptSession(_sessionId, _opts = {}) {
  // Intentional no-op. Cancellation is now handled by SIGTERM → installShutdownHandler.
}
