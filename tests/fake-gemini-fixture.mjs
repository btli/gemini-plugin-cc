import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FAKE_VERSION = "0.36.0";

const FAKE_REVIEW_RESPONSE = JSON.stringify({
  verdict: "needs-attention",
  summary: "Found a potential null reference and a missing error handler.",
  findings: [
    {
      severity: "high",
      title: "Potential null dereference",
      body: "The variable `user` may be null when accessed at this line.",
      file: "src/index.js",
      line_start: 42,
      line_end: 42,
      confidence: 0.9,
      recommendation: "Add a null check before accessing user properties."
    },
    {
      severity: "medium",
      title: "Missing error handler",
      body: "The async function does not catch errors from the database call.",
      file: "src/db.js",
      line_start: 15,
      line_end: 20,
      confidence: 0.8,
      recommendation: "Wrap the database call in a try-catch block."
    }
  ],
  next_steps: [
    "Fix the null dereference in src/index.js",
    "Add error handling to src/db.js"
  ]
});

const FAKE_TASK_RESPONSE = "I investigated the issue and found that the test failure is caused by a missing import. The fix is to add `import { helper } from './utils'` at the top of the test file.";

function generateScript() {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);

// --version
if (args.includes("--version")) {
  process.stdout.write("${FAKE_VERSION}\\n");
  process.exit(0);
}

// auth login
if (args[0] === "auth" && args[1] === "login") {
  process.stdout.write("Already authenticated.\\n");
  process.exit(0);
}

// Parse flags
let prompt = "";
let outputFormat = "text";
let approvalMode = "plan";
let hasPromptFlag = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-p" && args[i + 1]) {
    prompt = args[i + 1];
    hasPromptFlag = true;
    i++;
  } else if (args[i] === "-o" && args[i + 1]) {
    outputFormat = args[i + 1];
    i++;
  } else if (args[i] === "--approval-mode" && args[i + 1]) {
    approvalMode = args[i + 1];
    i++;
  }
}

if (!hasPromptFlag) {
  process.stderr.write("No prompt provided.\\n");
  process.exit(1);
}

// Detect review vs task based on prompt content
const isReview = prompt.toLowerCase().includes("review") || prompt.toLowerCase().includes("findings");

const sessionId = "test-session-" + Date.now();

if (outputFormat === "json") {
  const response = isReview ? ${JSON.stringify(FAKE_REVIEW_RESPONSE)} : ${JSON.stringify(FAKE_TASK_RESPONSE)};
  const output = JSON.stringify({
    session_id: sessionId,
    response: response,
    stats: { tokens_in: 1000, tokens_out: 500, duration_ms: 2000 }
  });
  process.stdout.write(output + "\\n");
} else if (outputFormat === "stream-json") {
  // NDJSON stream
  process.stdout.write(JSON.stringify({ type: "init", session_id: sessionId, model: "gemini-3-flash" }) + "\\n");
  const response = isReview ? ${JSON.stringify(FAKE_REVIEW_RESPONSE)} : ${JSON.stringify(FAKE_TASK_RESPONSE)};
  process.stdout.write(JSON.stringify({ type: "message", role: "assistant", content: response }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "result", status: "success", stats: { tokens_in: 1000, tokens_out: 500 } }) + "\\n");
} else {
  const response = isReview ? ${JSON.stringify(FAKE_REVIEW_RESPONSE)} : ${JSON.stringify(FAKE_TASK_RESPONSE)};
  process.stdout.write(response + "\\n");
}

process.exit(0);
`;
}

export function installFakeGemini(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "gemini");
  fs.writeFileSync(scriptPath, generateScript(), { mode: 0o755 });
  return scriptPath;
}

export function createFakeGeminiEnv(binDir) {
  return {
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: os.tmpdir(),
    GEMINI_API_KEY: "fake-test-key"
  };
}

export function removeFakeGemini(binDir) {
  try {
    fs.rmSync(binDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
