import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_VERSION = 1;
const MAX_JOBS = 50;
const FALLBACK_STATE_ROOT_DIR = "gemini-companion";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

function defaultStateRootDir() {
  const pluginData = process.env[PLUGIN_DATA_ENV];
  if (pluginData) {
    return pluginData;
  }
  return path.join(os.tmpdir(), FALLBACK_STATE_ROOT_DIR);
}

function workspaceSlug(workspaceRoot) {
  const name = path.basename(workspaceRoot);
  const hash = crypto.createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

export function resolveStateDir(workspaceRoot) {
  return path.join(defaultStateRootDir(), workspaceSlug(workspaceRoot));
}

export function resolveStateFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), "state.json");
}

export function resolveJobFile(workspaceRoot, jobId) {
  return path.join(resolveStateDir(workspaceRoot), `job-${jobId}.json`);
}

function defaultState() {
  return { version: STATE_VERSION, config: {}, jobs: [] };
}

export function loadState(workspaceRoot) {
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return { ...defaultState(), ...raw };
  } catch {
    return defaultState();
  }
}

export function saveState(workspaceRoot, state) {
  const stateDir = resolveStateDir(workspaceRoot);
  fs.mkdirSync(stateDir, { recursive: true });

  const pruned = { ...state, jobs: state.jobs.slice(0, MAX_JOBS) };

  const activeJobIds = new Set(pruned.jobs.map((job) => job.id));
  const stateFile = resolveStateFile(workspaceRoot);
  fs.writeFileSync(stateFile, `${JSON.stringify(pruned, null, 2)}\n`, "utf8");

  try {
    const entries = fs.readdirSync(stateDir);
    for (const entry of entries) {
      if (!entry.startsWith("job-") || !entry.endsWith(".json")) {
        continue;
      }
      const jobId = entry.slice(4, -5);
      if (!activeJobIds.has(jobId)) {
        fs.unlinkSync(path.join(stateDir, entry));
      }
    }
  } catch {
    // Ignore cleanup failures.
  }
}

export function upsertJob(workspaceRoot, job) {
  const state = loadState(workspaceRoot);
  const index = state.jobs.findIndex((existing) => existing.id === job.id);
  const now = new Date().toISOString();
  const updated = { ...job, updatedAt: now };

  if (index >= 0) {
    state.jobs[index] = { ...state.jobs[index], ...updated };
  } else {
    state.jobs.unshift({ createdAt: now, ...updated });
  }

  saveState(workspaceRoot, state);
  return updated;
}

export function listJobs(workspaceRoot) {
  return loadState(workspaceRoot).jobs;
}

export function getConfig(workspaceRoot) {
  return loadState(workspaceRoot).config ?? {};
}

export function setConfig(workspaceRoot, key, value) {
  const state = loadState(workspaceRoot);
  state.config = { ...state.config, [key]: value };
  saveState(workspaceRoot, state);
}

export function writeJobFile(workspaceRoot, jobId, payload) {
  const stateDir = resolveStateDir(workspaceRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  fs.writeFileSync(jobFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function readJobFile(jobFilePath) {
  try {
    return JSON.parse(fs.readFileSync(jobFilePath, "utf8"));
  } catch {
    return null;
  }
}

export function pruneJobs(workspaceRoot) {
  const state = loadState(workspaceRoot);
  if (state.jobs.length > MAX_JOBS) {
    state.jobs = state.jobs.slice(0, MAX_JOBS);
    saveState(workspaceRoot, state);
  }
}
