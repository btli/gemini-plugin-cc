import fs from "node:fs";
import path from "node:path";
import { writeExecutable } from "./helpers.mjs";

const FAKE_VERSION = "1.0.6";
export const FAKE_CONVERSATION_ID = "12345678-1234-4321-8765-1234567890ab";

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

/**
 * Generates a fake `agy` executable that mimics print mode:
 * reads the prompt from stdin, writes realistic glog lines to --log-file,
 * and emits behavior-dependent stdout/exit codes.
 *
 * Behaviors: task-ok | review-ok | echo-args | model-fallback | fail |
 *            rate-limit | auth-error | hang | write-file
 * The FAKE_AGY_BEHAVIOR env var overrides the baked-in behavior at run time.
 */
function generateScript(behavior) {
  return `#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const BEHAVIOR = process.env.FAKE_AGY_BEHAVIOR || ${JSON.stringify(behavior)};
const REVIEW_JSON = ${JSON.stringify(REVIEW_JSON)};
const CONVERSATION_ID = ${JSON.stringify(FAKE_CONVERSATION_ID)};

const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write(${JSON.stringify(FAKE_VERSION)} + '\\n');
  process.exit(0);
}

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

if (!args.includes('--print')) {
  process.stderr.write('fake-agy: unknown invocation\\n');
  process.exit(1);
}

const logFile = argValue('--log-file');
const modelLabel = argValue('--model');
const conversation = argValue('--conversation');

function writeLog() {
  if (!logFile) return;
  const lines = [];
  if (conversation) {
    lines.push('I0101 00:00:00.000000 1 printmode.go:147] Print mode: resuming conversation ' + conversation);
  } else {
    lines.push('I0101 00:00:00.000000 1 printmode.go:147] Print mode: conversation=' + CONVERSATION_ID + ', sending message');
  }
  const propagated = BEHAVIOR === 'model-fallback'
    ? 'Gemini 3.5 Flash (Medium)'
    : (modelLabel || 'Gemini 3.5 Flash (Medium)');
  lines.push('I0101 00:00:00.000000 1 model_config_manager.go:157] Propagating selected model override to backend: label="' + propagated + '"');
  fs.writeFileSync(logFile, lines.join('\\n') + '\\n', 'utf8');
}

let prompt = '';
try {
  prompt = fs.readFileSync(0, 'utf8');
} catch {
  prompt = '';
}

writeLog();

if (BEHAVIOR === 'hang') {
  setInterval(() => {}, 1000);
} else if (BEHAVIOR === 'fail') {
  process.stderr.write('fake-agy: boom\\n');
  process.exit(1);
} else if (BEHAVIOR === 'rate-limit') {
  process.stderr.write('Error: RESOURCE_EXHAUSTED: quota exceeded\\n');
  process.exit(1);
} else if (BEHAVIOR === 'auth-error') {
  process.stderr.write('Error: You are not logged into Antigravity.\\n');
  process.exit(1);
} else if (BEHAVIOR === 'review-ok') {
  process.stdout.write(REVIEW_JSON);
  process.exit(0);
} else if (BEHAVIOR === 'echo-args') {
  process.stdout.write(JSON.stringify({ args: args, prompt: prompt }));
  process.exit(0);
} else if (BEHAVIOR === 'write-file') {
  fs.writeFileSync('agy-wrote.txt', 'stray write', 'utf8');
  process.stdout.write('TASK_COMPLETE: wrote file');
  process.exit(0);
} else {
  process.stdout.write('TASK_COMPLETE: ' + prompt.slice(0, 60).replace(/\\n/g, ' '));
  process.exit(0);
}
`;
}

export function installFakeAgy(binDir, behavior = "task-ok") {
  const scriptPath = path.join(binDir, "agy");
  writeExecutable(scriptPath, generateScript(behavior));
  return scriptPath;
}

/**
 * Env for spawning the companion against the fake agy: PATH-prepends binDir
 * and points HOME at a fake home containing ~/.gemini/oauth_creds.json so
 * auth detection reports logged-in.
 */
export function createFakeAgyEnv(binDir, options = {}) {
  const homeDir = options.homeDir ?? fs.mkdtempSync(path.join(binDir, "home-"));
  const geminiDir = path.join(homeDir, ".gemini");
  fs.mkdirSync(geminiDir, { recursive: true });
  fs.writeFileSync(path.join(geminiDir, "oauth_creds.json"), "{}\n", "utf8");
  return {
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: homeDir,
    USERPROFILE: homeDir
  };
}

export function removeFakeAgy(binDir) {
  try {
    fs.rmSync(binDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
