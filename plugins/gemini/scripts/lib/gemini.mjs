import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, resumeSession, spawnAcpClient } from "./acp-lifecycle.mjs";
import { resolveModel, suggestAlternatives } from "./models.mjs";
import { binaryAvailable } from "./process.mjs";
import { readJsonFile } from "./fs.mjs";
import { appendLogLine } from "./tracked-jobs.mjs";
import { upsertJob } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

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

function buildModelFailureResult(sessionId, model, resolvedModel, message) {
  const alternatives = suggestAlternatives(resolvedModel);
  const suggestion = alternatives.length > 0 ? ` Try: --model ${alternatives[0]}` : "";
  return {
    ok: false,
    rawOutput: "",
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

  // Persist sessionId immediately for graceful cancel support
  if (jobId && effectiveWorkspaceRoot) {
    try {
      upsertJob(effectiveWorkspaceRoot, { id: jobId, sessionId });
    } catch {
      // non-fatal — state write may fail in edge cases
    }
  }

  const chunks = [];

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
      appendLogLine(logFile, update.content.text);
      onProgress?.({ message: update.content.text, phase: "streaming" });
    } else if (update.sessionUpdate === "tool_call") {
      const toolName = update.name ?? "tool";
      appendLogLine(logFile, `[tool_call] ${toolName}`);
      onProgress?.({ message: `Running: ${toolName}`, phase: "tool_call" });
    }
  });

  const promptTimeoutMs = timeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;

  let timeoutTimer;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new Error(`Gemini prompt timed out after ${Math.round(promptTimeoutMs / 1000)}s.`));
    }, promptTimeoutMs);
    timeoutTimer.unref?.();
  });

  let result;
  try {
    result = await Promise.race([
      client.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: prompt }]
      }),
      timeoutPromise
    ]);
    clearTimeout(timeoutTimer);
  } catch (err) {
    clearTimeout(timeoutTimer);
    // On timeout, try graceful cancel before closing
    try { client.notify("session/cancel", { sessionId }); } catch {}
    await client.close().catch(() => {});
    const msg = err?.message ?? String(err);

    if (/429|RESOURCE_EXHAUSTED|capacity|rate.limit/i.test(msg)) {
      return buildModelFailureResult(sessionId, model, resolvedModel, `Model "${model ?? "default"}" hit rate limits.`);
    }
    if (/malformed function call/i.test(msg)) {
      return buildModelFailureResult(sessionId, model, resolvedModel, `Model "${model ?? "default"}" returned malformed output.`);
    }
    return {
      ok: false,
      rawOutput: "",
      sessionId,
      stopReason: null,
      failureMessage: msg
    };
  }

  await client.close().catch(() => {});

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
 * Spawns a fresh short-lived ACP client, sends the cancel notification,
 * waits briefly for it to take effect, then closes.
 *
 * @param {string} sessionId - the session to cancel
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {object} [opts.env]
 * @param {string} [opts.workspaceRoot]
 * @returns {Promise<void>}
 */
export async function interruptSession(sessionId, opts = {}) {
  const client = await spawnAcpClient({
    cwd: opts.cwd,
    env: opts.env,
    workspaceRoot: opts.workspaceRoot
  });

  try {
    client.notify("session/cancel", { sessionId });
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    await client.close().catch(() => {});
  }
}
