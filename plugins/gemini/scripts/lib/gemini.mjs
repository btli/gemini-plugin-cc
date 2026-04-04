import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { binaryAvailable, runCommand } from "./process.mjs";
import { readJsonFile } from "./fs.mjs";
import { resolveModel } from "./models.mjs";
export { resolveModel as normalizeRequestedModel } from "./models.mjs";

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

function buildGeminiArgs(options = {}) {
  const args = [];

  if (options.prompt) {
    args.push("-p", options.prompt);
  }

  if (options.model) {
    const model = resolveModel(options.model);
    if (model) {
      args.push("-m", model);
    }
  }

  if (options.outputFormat) {
    args.push("-o", options.outputFormat);
  }

  if (options.approvalMode) {
    args.push("--approval-mode", options.approvalMode);
  }

  if (options.resume) {
    args.push("--resume", options.resume);
  }

  if (options.yolo) {
    args.push("-y");
  }

  if (options.sandbox === false) {
    args.push("--no-sandbox");
  }

  if (options.disableExtensions) {
    args.push("--no-extensions");
  }

  return args;
}

function cleanGeminiStderr(stderr) {
  if (!stderr) {
    return "";
  }
  return stderr
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }
      // Filter common noise
      if (trimmed.startsWith("Keychain") || trimmed.startsWith("keychain")) {
        return false;
      }
      if (trimmed.includes("Loading extensions")) {
        return false;
      }
      if (trimmed.includes("ExperimentalWarning")) {
        return false;
      }
      if (trimmed.startsWith("(node:")) {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

export function runGeminiSync(cwd, options = {}) {
  const args = buildGeminiArgs(options);
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;

  const result = spawnSync("gemini", args, {
    cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
    input: options.stdinInput ?? undefined
  });

  if (result.error?.code === "ETIMEDOUT") {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      error: `Gemini timed out after ${Math.round(timeoutMs / 1000)}s`
    };
  }

  if (result.error?.code === "ENOENT") {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "gemini CLI not found. Install with: npm install -g @google/gemini-cli"
    };
  }

  if (result.error) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: result.error.message
    };
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: cleanGeminiStderr(result.stderr),
    timedOut: false,
    error: result.status !== 0 ? cleanGeminiStderr(result.stderr) || `exit ${result.status}` : null
  };
}

export function parseJsonOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    return { parsed: false, parseError: "Empty output", rawOutput: "" };
  }

  try {
    const data = JSON.parse(text);
    return {
      parsed: true,
      sessionId: data.session_id ?? null,
      response: data.response ?? data.text ?? "",
      stats: data.stats ?? null,
      rawOutput: text
    };
  } catch {
    // Gemini may output the response directly without JSON wrapper
    return {
      parsed: false,
      parseError: "Output is not valid JSON",
      rawOutput: text
    };
  }
}

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

export function runGeminiTask(cwd, options = {}) {
  const {
    prompt,
    model,
    write = true,
    resume,
    timeoutMs,
    env
  } = options;

  const geminiOptions = {
    prompt,
    model,
    outputFormat: "json",
    approvalMode: write ? "yolo" : "plan",
    resume: resume ?? undefined,
    disableExtensions: options.disableExtensions ?? false,
    timeoutMs,
    env
  };

  const result = runGeminiSync(cwd, geminiOptions);
  if (!result.ok) {
    return {
      ok: false,
      rawOutput: result.stderr || result.error,
      sessionId: null,
      failureMessage: result.error
    };
  }

  const parsed = parseJsonOutput(result.stdout);
  if (parsed.parsed) {
    return {
      ok: true,
      rawOutput: parsed.response,
      sessionId: parsed.sessionId,
      stats: parsed.stats,
      failureMessage: null
    };
  }

  // Fallback: treat stdout as raw text response
  return {
    ok: true,
    rawOutput: result.stdout.trim(),
    sessionId: null,
    stats: null,
    failureMessage: null
  };
}

export function runGeminiReview(cwd, options = {}) {
  const {
    prompt,
    model,
    timeoutMs,
    env
  } = options;

  const geminiOptions = {
    prompt,
    model,
    outputFormat: "json",
    approvalMode: "plan", // Reviews are always read-only
    disableExtensions: true, // Keep reviews fast
    timeoutMs,
    env
  };

  const result = runGeminiSync(cwd, geminiOptions);
  if (!result.ok) {
    return {
      ok: false,
      parsed: null,
      parseError: result.error,
      rawOutput: result.stderr || "",
      sessionId: null,
      reasoningSummary: null
    };
  }

  const jsonResult = parseJsonOutput(result.stdout);
  const responseText = jsonResult.parsed ? jsonResult.response : result.stdout.trim();
  const structuredResult = parseStructuredOutput(responseText);

  return {
    ok: true,
    ...structuredResult,
    sessionId: jsonResult.sessionId ?? null,
    reasoningSummary: null
  };
}

export function findLatestTaskSession(workspaceRoot, listJobs) {
  const jobs = listJobs(workspaceRoot);
  const taskJobs = jobs
    .filter((job) => job.jobClass === "task" && job.sessionId)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  return taskJobs[0] ?? null;
}

export function spawnGeminiBackground(cwd, options = {}) {
  const args = buildGeminiArgs(options);
  const logFd = options.logFile ? fs.openSync(options.logFile, "a") : "ignore";

  const child = spawn("gemini", args, {
    cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: ["pipe", logFd, logFd]
  });

  child.unref();

  if (typeof logFd === "number") {
    fs.closeSync(logFd);
  }

  return child;
}
