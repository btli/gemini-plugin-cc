import { readFile, stat, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { GeminiAcpClient } from "./acp-client.mjs";
import { isProcessAlive, runCommand } from "./process.mjs";
import { appendLogLine } from "./tracked-jobs.mjs";

const SESSION_SETUP_TIMEOUT_MS = 10_000;
const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB

export function withTimeout(promise, ms, label) {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`withTimeout: invalid timeout ${ms} for "${label}"`);
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s.`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
 * Resolve a file path's symlinks and verify the real path is still within the workspace.
 * Throws if the resolved symlink target escapes the workspace root.
 *
 * @param {string} workspaceRoot - the workspace root directory
 * @param {string} filePath - the already-resolved logical path to check
 * @returns {Promise<string>} the real (symlink-resolved) path
 */
async function assertContainedRealpath(workspaceRoot, filePath) {
  const realFilePath = await realpath(filePath);
  const normalizedRoot = path.resolve(workspaceRoot);

  if (realFilePath !== normalizedRoot && !realFilePath.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path resolves outside workspace via symlink.`);
  }
  return realFilePath;
}

/**
 * Register default ACP tool handlers on the client for filesystem and permission operations.
 */
export function installDefaultHandlers(client, opts = {}) {
  const { workspaceRoot, write = false, logFile } = opts;

  client.onServerRequest("fs/read_text_file", async (params) => {
    const filePath = resolveContainedPath(workspaceRoot, params.path);
    const realFilePath = await assertContainedRealpath(workspaceRoot, filePath);
    const fileStat = await stat(realFilePath);
    if (fileStat.size > MAX_READ_BYTES) {
      throw new Error(`File too large (${(fileStat.size / 1024 / 1024).toFixed(1)} MB). Max: 5 MB.`);
    }
    appendLogLine(logFile, `fs/read_text_file: ${realFilePath}`);
    const content = await readFile(realFilePath, "utf8");
    return { content };
  });

  if (write) {
    client.onServerRequest("fs/write_text_file", async (params) => {
      const filePath = resolveContainedPath(workspaceRoot, params.path);
      // Check target file itself first — if it exists as a symlink pointing
      // outside workspace, writeFile would follow it and escape the sandbox
      try {
        await assertContainedRealpath(workspaceRoot, filePath);
      } catch (err) {
        if (err.code === "ENOENT") {
          // File doesn't exist yet — check the parent directory instead
          const parentDir = path.dirname(filePath);
          try {
            await assertContainedRealpath(workspaceRoot, parentDir);
          } catch (parentErr) {
            if (parentErr.code !== "ENOENT") {
              throw parentErr;
            }
            // Parent also doesn't exist — logical path check is sufficient
          }
        } else {
          throw err;
        }
      }
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

  try {
    await withTimeout(
      client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "gemini-companion", version: "1.0.0" },
        clientCapabilities: {},
      }),
      SESSION_SETUP_TIMEOUT_MS, "ACP initialize"
    );
    // Send initialized notification (required by Gemini ACP before session operations)
    client.notify("initialized", {});
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }

  return client;
}

/**
 * Apply mode and model settings to a session.
 */
async function applySessionSettings(client, sessionId, opts) {
  const setup = [
    withTimeout(
      client.request("session/set_mode", { sessionId, modeId: opts.modeId ?? "default" }),
      SESSION_SETUP_TIMEOUT_MS, "session/set_mode"
    )
  ];
  if (opts.model) {
    setup.push(withTimeout(
      client.request("session/set_model", { sessionId, modelId: opts.model }),
      SESSION_SETUP_TIMEOUT_MS, "session/set_model"
    ));
  }
  await Promise.all(setup);
}

/**
 * Create a new ACP session. Returns { client, sessionId }.
 */
export async function createSession(opts = {}) {
  const client = await spawnAcpClient(opts);
  try {
    const cwd = opts.cwd ?? process.cwd();
    const { sessionId } = await withTimeout(
      client.request("session/new", { cwd, mcpServers: [] }),
      SESSION_SETUP_TIMEOUT_MS, "session/new"
    );
    await applySessionSettings(client, sessionId, opts);
    return { client, sessionId };
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

/**
 * Resume an existing ACP session by ID. Returns { client, sessionId }.
 */
export async function resumeSession(sessionId, opts = {}) {
  const client = await spawnAcpClient(opts);
  try {
    const cwd = opts.cwd ?? process.cwd();
    await withTimeout(
      client.request("session/load", { sessionId, cwd }),
      SESSION_SETUP_TIMEOUT_MS, "session/load"
    );
    await applySessionSettings(client, sessionId, opts);
    return { client, sessionId };
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

/**
 * Check whether an ACP client's underlying process is still alive.
 */
export function isAlive(client) {
  return !client.exited && isProcessAlive(client.pid);
}

