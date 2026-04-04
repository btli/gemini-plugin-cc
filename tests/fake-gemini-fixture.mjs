import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeExecutable } from "./helpers.mjs";

const FAKE_VERSION = "0.36.0";

const REVIEW_JSON = JSON.stringify({
  verdict: "needs-attention",
  summary: "Found a potential null reference and a missing error handler.",
  findings: [
    {
      severity: "high",
      title: "Potential null dereference",
      body: "The variable user may be null when accessed at this line.",
      file: "src/index.js",
      line_start: 42,
      line_end: 42,
      recommendation: "Add a null check before accessing user properties."
    },
    {
      severity: "medium",
      title: "Missing error handler",
      body: "The async function does not catch errors from the database call.",
      file: "src/db.js",
      line_start: 15,
      line_end: 20,
      recommendation: "Wrap the database call in a try-catch block."
    }
  ],
  next_steps: [
    "Fix the null dereference in src/index.js",
    "Add error handling to src/db.js"
  ]
});

function generateScript(behavior, statePath) {
  // Escape for embedding inside a JS template literal that itself lives inside
  // a JS string — we only need to escape backslashes and backticks.
  const escapedStatePath = statePath.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
  const escapedReviewJson = REVIEW_JSON.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  const escapedBehavior = behavior.replace(/`/g, "\\`");

  return `#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const BEHAVIOR = ${JSON.stringify(behavior)};
const STATE_PATH = ${JSON.stringify(statePath)};
const REVIEW_JSON = ${JSON.stringify(REVIEW_JSON)};

// --- State helpers ---
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8');
}

// --- Version check ---
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write(${JSON.stringify(FAKE_VERSION)} + '\\n');
  process.exit(0);
}

// --- ACP mode ---
if (!args.includes('--acp')) {
  process.stderr.write('fake-gemini: unknown invocation\\n');
  process.exit(1);
}

// --- JSON-RPC helpers ---
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

function sendNotification(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// --- Session state ---
const state = loadState();
state.calls = state.calls || [];

// --- ACP notification helpers ---
function sendSessionChunk(text) {
  const sid = state.sessionId || 'fake-session';
  send({
    method: 'session/update',
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: text }
      }
    }
  });
}

function sendSessionToolCall(toolName) {
  const sid = state.sessionId || 'fake-session';
  send({
    method: 'session/update',
    params: {
      sessionId: sid,
      update: {
        sessionUpdate: 'tool_call',
        name: toolName
      }
    }
  });
}

// --- Prompt handler ---
function handlePrompt(id, params) {
  state.calls.push({ method: 'session/prompt', params });
  saveState(state);

  if (BEHAVIOR === 'crash') {
    process.exit(1);
  }

  if (BEHAVIOR === 'hang') {
    // Never respond
    return;
  }

  if (BEHAVIOR === 'rate-limit') {
    sendError(id, -32000, '429 RESOURCE_EXHAUSTED: rate limit exceeded');
    return;
  }

  if (BEHAVIOR === 'permission') {
    // Server-initiated permission request
    sendNotification('session/request_permission', {
      id: 9999,
      permission: { type: 'exec', command: 'ls' }
    });
    // Wait for client response on stdin, then complete
    // We handle this by setting a flag; the readline loop will send the result
    // after the permission response arrives.
    state._pendingPromptId = id;
    saveState(state);
    return;
  }

  if (BEHAVIOR === 'write-in-readonly') {
    sendSessionToolCall('fs/write_text_file');
    sendResult(id, { stopReason: 'end_turn', sessionId: state.sessionId || 'fake-session' });
    return;
  }

  if (BEHAVIOR === 'path-escape') {
    sendSessionToolCall('fs/read_text_file');
    sendResult(id, { stopReason: 'end_turn', sessionId: state.sessionId || 'fake-session' });
    return;
  }

  // review-ok or session-load
  if (BEHAVIOR === 'review-ok' || BEHAVIOR === 'session-load') {
    sendSessionChunk(REVIEW_JSON);
    sendResult(id, { stopReason: 'end_turn', sessionId: state.sessionId || 'fake-session' });
    return;
  }

  // Default: task-ok
  sendSessionChunk('Task complete.');
  sendResult(id, { stopReason: 'end_turn', sessionId: state.sessionId || 'fake-session' });
}

// --- Readline loop ---
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  state.calls = state.calls || [];

  switch (method) {
    case 'initialize':
      state.calls.push({ method, params });
      saveState(state);
      sendResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: { name: 'fake-gemini', version: ${JSON.stringify(FAKE_VERSION)} }
      });
      break;

    case 'session/new':
      state.sessionId = 'fake-session-' + Date.now();
      state.calls.push({ method, params });
      saveState(state);
      sendResult(id, { sessionId: state.sessionId });
      break;

    case 'session/load':
      state.calls.push({ method, params });
      saveState(state);
      sendResult(id, { sessionId: params && params.sessionId ? params.sessionId : state.sessionId || 'fake-session' });
      break;

    case 'session/set_mode':
    case 'session/set_model':
      state.calls.push({ method, params });
      saveState(state);
      sendResult(id, {});
      break;

    case 'session/prompt':
      handlePrompt(id, params);
      break;

    case 'session/cancel':
      // Notification — no id, no response
      state.calls.push({ method, params });
      saveState(state);
      break;

    case 'session/list':
      state.calls.push({ method, params });
      saveState(state);
      sendResult(id, { sessions: state.sessionId ? [{ sessionId: state.sessionId }] : [] });
      break;

    case 'session/close':
      state.calls.push({ method, params });
      saveState(state);
      sendResult(id, {});
      break;

    default:
      if (!isNotification) {
        // Check if this is a permission response (result with no method)
        if (msg.result !== undefined && state._pendingPromptId !== undefined) {
          const pendingId = state._pendingPromptId;
          delete state._pendingPromptId;
          saveState(state);
          sendSessionChunk('Task complete.');
          sendResult(pendingId, { stopReason: 'end_turn', sessionId: state.sessionId || 'fake-session' });
        } else {
          sendError(id, -32601, 'Method not found: ' + method);
        }
      }
      break;
  }
});

rl.on('close', () => {
  process.exit(0);
});
`;
}

/**
 * Install fake gemini binary into binDir.
 * @param {string} binDir - directory to install into (created if needed)
 * @param {string} [behavior="task-ok"] - behavior preset
 * @returns {string} path to state JSON file
 */
export function installFakeGemini(binDir, behavior = "task-ok") {
  fs.mkdirSync(binDir, { recursive: true });
  const statePath = path.join(binDir, "fake-gemini-state.json");
  const scriptPath = path.join(binDir, "gemini");
  const source = generateScript(behavior, statePath);
  writeExecutable(scriptPath, source);
  return statePath;
}

/**
 * Create environment variables for running gemini-companion with the fake binary.
 * @param {string} binDir
 * @returns {{ PATH: string, HOME: string, GEMINI_API_KEY: string }}
 */
export function createFakeGeminiEnv(binDir) {
  return {
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: os.tmpdir(),
    GEMINI_API_KEY: "fake-test-key"
  };
}

/**
 * Read the persisted state from the fake gemini binary.
 * @param {string} binDir
 * @returns {object|null}
 */
export function readFakeState(binDir) {
  const statePath = path.join(binDir, "fake-gemini-state.json");
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Remove the fake gemini bin directory.
 * @param {string} binDir
 */
export function removeFakeGemini(binDir) {
  try {
    fs.rmSync(binDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
