import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { GeminiAcpClient } from "./acp-client.mjs";
import { runCommand } from "./process.mjs";
import { appendLogLine } from "./tracked-jobs.mjs";

/** @type {Map<string, string>} */
const flagCache = new Map();

/**
 * Detect the correct ACP flag for the given Gemini binary based on its version.
 * Returns "--experimental-acp" for versions < 0.33, "--acp" otherwise.
 * Results are cached per binary.
 */
export function detectAcpFlag(binary = "gemini") {
  const cached = flagCache.get(binary);
  if (cached !== undefined) {
    return cached;
  }

  const result = runCommand(binary, ["--version"]);
  const stdout = result.stdout ?? "";
  const match = stdout.match(/(\d+)\.(\d+)\.(\d+)/);

  let flag = "--acp";
  if (match) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major === 0 && minor < 33) {
      flag = "--experimental-acp";
    }
  }

  flagCache.set(binary, flag);
  return flag;
}

/**
 * Clear the cached ACP flag results.
 */
export function clearFlagCache() {
  flagCache.clear();
}

/**
 * Resolve a path relative to workspaceRoot, rejecting any path that escapes the workspace.
 * Absolute requestedPath values are always rejected.
 */
export function resolveContainedPath(workspaceRoot, requestedPath) {
  if (path.isAbsolute(requestedPath)) {
    throw new Error(`Path "${requestedPath}" is absolute and outside workspace.`);
  }

  const resolved = path.resolve(workspaceRoot, requestedPath);
  const normalizedRoot = path.resolve(workspaceRoot);

  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path "${requestedPath}" resolves outside workspace.`);
  }

  return resolved;
}

/**
 * Register default ACP tool handlers on the client for filesystem and permission operations.
 */
export function installDefaultHandlers(client, opts = {}) {
  const { workspaceRoot, write = false, logFile } = opts;

  client.onServerRequest("fs/read_text_file", async (params) => {
    const filePath = resolveContainedPath(workspaceRoot, params.path);
    appendLogLine(logFile, `fs/read_text_file: ${filePath}`);
    const content = await readFile(filePath, "utf8");
    return { content };
  });

  if (write) {
    client.onServerRequest("fs/write_text_file", async (params) => {
      const filePath = resolveContainedPath(workspaceRoot, params.path);
      appendLogLine(logFile, `fs/write_text_file: ${filePath}`);
      await writeFile(filePath, params.content, "utf8");
      return {};
    });
  }

  client.onServerRequest("session/request_permission", async (params) => {
    appendLogLine(logFile, `session/request_permission: ${params?.description ?? "unknown"}`);
    return { approved: write };
  });
}

/**
 * Spawn a Gemini ACP subprocess, create a client, optionally install default handlers,
 * and perform the initialize handshake.
 */
export async function spawnAcpClient(opts = {}) {
  const {
    binary = "gemini",
    cwd,
    env,
    workspaceRoot,
    write = false,
    logFile,
  } = opts;

  const flag = detectAcpFlag(binary);
  const proc = spawn(binary, [flag], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const client = new GeminiAcpClient(proc);

  if (workspaceRoot) {
    installDefaultHandlers(client, { workspaceRoot, write, logFile });
  }

  const timeout = new Promise((_, reject) => {
    const t = setTimeout(() => {
      reject(new Error("ACP initialize handshake timed out after 10s."));
    }, 10_000);
    // Allow the process to exit without waiting for the timer
    if (t.unref) {
      t.unref();
    }
  });

  await Promise.race([
    client.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "gemini-companion", version: "1.0.0" },
      clientCapabilities: {},
    }),
    timeout,
  ]);

  return client;
}

/**
 * Create a new ACP session. Returns { client, sessionId }.
 */
export async function createSession(opts = {}) {
  const client = await spawnAcpClient(opts);
  const { sessionId } = await client.request("session/new", {
    cwd: opts.cwd ?? process.cwd(),
  });
  await client.request("session/set_mode", {
    sessionId,
    modeId: opts.modeId ?? "default",
  });
  if (opts.model) {
    await client.request("session/set_model", {
      sessionId,
      modelId: opts.model,
    });
  }
  return { client, sessionId };
}

/**
 * Resume an existing ACP session by ID. Returns { client, sessionId }.
 */
export async function resumeSession(sessionId, opts = {}) {
  const client = await spawnAcpClient(opts);
  await client.request("session/load", {
    sessionId,
    cwd: opts.cwd ?? process.cwd(),
  });
  return { client, sessionId };
}

/**
 * Check whether an ACP client's underlying process is still alive.
 */
export function isAlive(client) {
  if (client.exited) {
    return false;
  }
  try {
    process.kill(client.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convenience wrapper: spawn an ACP client, run fn(client), then close.
 */
export async function withAcpClient(cwd, fn, opts = {}) {
  const client = await spawnAcpClient({ ...opts, cwd });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}
