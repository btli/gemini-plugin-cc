# Antigravity (agy) Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deprecated Gemini CLI ACP backend with `agy` (Antigravity) print-mode execution, with a full rebrand to the `antigravity` plugin namespace.

**Architecture:** A thin subprocess layer (`agy-cli.mjs`) spawns `agy --print` with the prompt on stdin and parses the conversation ID + effective model from agy's per-job glog. The facade (`antigravity.mjs`) keeps the exact result shapes of the old `gemini.mjs`, so job-control/state/render survive with renames. Reviews run inside disposable git worktrees (`review-worktree.mjs`) because agy has no read-only mode.

**Tech Stack:** Node.js 18.18+ ESM (`.mjs`), zero dependencies, `node --test tests/*.test.mjs`, no build step.

**Spec:** `docs/superpowers/specs/2026-06-06-antigravity-adaptation-design.md`

**Verified agy facts this plan relies on** (probed live on agy 1.0.6 — see spec for details):
- `agy --print "" --print-timeout <N>s --model "<Display Label>" --log-file <path> [--conversation <uuid>] [--dangerously-skip-permissions]`, prompt via stdin.
- agy's log contains `Print mode: conversation=<uuid>` (fresh) / `Print mode: resuming conversation <uuid>` (resume) and `Propagating selected model override to backend: label="<label>"`.
- `--model` accepts ONLY display labels like `Gemini 3.1 Pro (High)`; anything else silently falls back to `Gemini 3.5 Flash (Medium)` (detectable via the propagated label).
- Auth markers live in `~/.gemini/` (`oauth_creds.json`, `google_accounts.json`).
- Print mode auto-approves file writes regardless of flags — hence worktree isolation for reviews.

**Known pre-existing quirk — do NOT "fix":** the job `sessionId` field is dual-purpose: `createJobRecord` seeds it with the Claude session id (from `SESSION_ID_ENV`), and the task runner later overwrites it with the backend session/conversation id. Preserve this behavior exactly.

**Branch:** all work happens on `feat/antigravity-adaptation` (already created, spec committed).

---

### Task 1: Mechanical rename (paths + identity only, zero prose changes)

Renames directories/files and fixes every path reference so the suite stays green. No wording changes, no behavior changes.

**Files:**
- Rename: `plugins/gemini/` → `plugins/antigravity/` (whole tree)
- Rename: `plugins/antigravity/scripts/gemini-companion.mjs` → `antigravity-companion.mjs`
- Rename: `plugins/antigravity/scripts/lib/gemini.mjs` → `lib/antigravity.mjs`
- Rename: `plugins/antigravity/agents/gemini-rescue.md` → `agents/antigravity-rescue.md`
- Rename: `plugins/antigravity/skills/gemini-cli-runtime/` → `skills/antigravity-cli-runtime/`
- Rename: `plugins/antigravity/skills/gemini-prompting/` → `skills/antigravity-prompting/`
- Rename: `plugins/antigravity/skills/gemini-result-handling/` → `skills/antigravity-result-handling/`
- Modify: `plugins/antigravity/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Modify: import/path references in `antigravity-companion.mjs`, `stop-review-gate-hook.mjs`, all 7 `commands/*.md`, `tests/helpers.mjs`, and every `tests/*.test.mjs`

- [ ] **Step 1: git mv everything**

```bash
cd /Users/bryanli/Projects/btli/gemini-plugin-cc
git mv plugins/gemini plugins/antigravity
git mv plugins/antigravity/scripts/gemini-companion.mjs plugins/antigravity/scripts/antigravity-companion.mjs
git mv plugins/antigravity/scripts/lib/gemini.mjs plugins/antigravity/scripts/lib/antigravity.mjs
git mv plugins/antigravity/agents/gemini-rescue.md plugins/antigravity/agents/antigravity-rescue.md
git mv plugins/antigravity/skills/gemini-cli-runtime plugins/antigravity/skills/antigravity-cli-runtime
git mv plugins/antigravity/skills/gemini-prompting plugins/antigravity/skills/antigravity-prompting
git mv plugins/antigravity/skills/gemini-result-handling plugins/antigravity/skills/antigravity-result-handling
```

- [ ] **Step 2: Rewrite the plugin manifest**

`plugins/antigravity/.claude-plugin/plugin.json` — full new content:

```json
{
  "name": "antigravity",
  "version": "2.0.0",
  "description": "Use Antigravity (agy) from Claude Code to review code or delegate tasks.",
  "author": {
    "name": "Community"
  }
}
```

- [ ] **Step 3: Rewrite the marketplace manifest**

`.claude-plugin/marketplace.json` — full new content:

```json
{
  "name": "antigravity",
  "owner": {
    "name": "Community"
  },
  "metadata": {
    "description": "Antigravity plugin to use in Claude Code for delegation and code review.",
    "version": "2.0.0"
  },
  "plugins": [
    {
      "name": "antigravity",
      "description": "Use Antigravity (agy) from Claude Code to review code or delegate tasks.",
      "version": "2.0.0",
      "author": {
        "name": "Community"
      },
      "source": "./plugins/antigravity"
    }
  ]
}
```

- [ ] **Step 4: Fix imports inside the plugin scripts**

In `plugins/antigravity/scripts/antigravity-companion.mjs`, change the import line:

```js
// old
} from "./lib/gemini.mjs";
// new
} from "./lib/antigravity.mjs";
```

In `plugins/antigravity/scripts/stop-review-gate-hook.mjs`:

```js
// old
import { getGeminiAuthStatus } from "./lib/gemini.mjs";
// new
import { getGeminiAuthStatus } from "./lib/antigravity.mjs";
```

and the worker spawn path (line ~96):

```js
// old
const scriptPath = path.join(SCRIPT_DIR, "gemini-companion.mjs");
// new
const scriptPath = path.join(SCRIPT_DIR, "antigravity-companion.mjs");
```

(Function names like `getGeminiAuthStatus` stay as-is in this task — symbol renames happen in Task 5.)

- [ ] **Step 5: Fix script paths in command markdown files**

In all 7 files `plugins/antigravity/commands/{adversarial-review,cancel,rescue,result,review,setup,status}.md`, replace every occurrence of:

```
${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs
```

with:

```
${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs
```

(Prose still says "Gemini" — that's Task 7.)

- [ ] **Step 6: Fix test path references**

`tests/helpers.mjs` — in `runCompanion`, change the path segments:

```js
// old
    "plugins",
    "gemini",
    "scripts",
    "gemini-companion.mjs"
// new
    "plugins",
    "antigravity",
    "scripts",
    "antigravity-companion.mjs"
```

In every test file importing from the plugin, replace `../plugins/gemini/scripts/` with `../plugins/antigravity/scripts/`:
- `tests/acp-client.test.mjs`, `tests/acp-lifecycle.test.mjs`, `tests/acp-security.test.mjs` (acp-*.mjs paths, same dir)
- `tests/commands.test.mjs` (`lib/args.mjs`)
- `tests/extract-result-text.test.mjs` — also `lib/gemini.mjs` → `lib/antigravity.mjs`
- `tests/git.test.mjs`, `tests/process.test.mjs`, `tests/render.test.mjs`, `tests/state.test.mjs`, `tests/models.test.mjs`

Quick check that nothing still points at the old tree:

```bash
grep -rn "plugins/gemini\|gemini-companion.mjs\|lib/gemini.mjs" tests/ plugins/ .claude-plugin/ | grep -v node_modules
```

Expected: no output.

- [ ] **Step 7: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: all tests PASS (same count as before the rename).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename plugin tree to antigravity (paths/identity only)"
```

---

### Task 2: Models — agy display labels (TDD)

agy's `--model` accepts display labels only. Replace the model table and aliases; default is `Gemini 3.1 Pro (High)`.

**Files:**
- Modify: `plugins/antigravity/scripts/lib/models.mjs` (full rewrite)
- Test: `tests/models.test.mjs` (full rewrite)

- [ ] **Step 1: Rewrite the failing tests**

`tests/models.test.mjs` — full new content:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveModel,
  suggestAlternatives,
  MODELS,
  MODEL_ALIASES,
  DEFAULT_MODEL
} from "../plugins/antigravity/scripts/lib/models.mjs";

describe("resolveModel", () => {
  it("resolves 'pro' to the Gemini 3.1 Pro (High) label", () => {
    assert.equal(resolveModel("pro"), "Gemini 3.1 Pro (High)");
  });

  it("resolves 'pro-low'", () => {
    assert.equal(resolveModel("pro-low"), "Gemini 3.1 Pro (Low)");
  });

  it("resolves 'flash' to the high reasoning tier", () => {
    assert.equal(resolveModel("flash"), "Gemini 3.5 Flash (High)");
  });

  it("resolves 'flash-medium'", () => {
    assert.equal(resolveModel("flash-medium"), "Gemini 3.5 Flash (Medium)");
  });

  it("resolves 'flash-low'", () => {
    assert.equal(resolveModel("flash-low"), "Gemini 3.5 Flash (Low)");
  });

  it("resolves 'sonnet'", () => {
    assert.equal(resolveModel("sonnet"), "Claude Sonnet 4.6 (Thinking)");
  });

  it("resolves 'opus'", () => {
    assert.equal(resolveModel("opus"), "Claude Opus 4.6 (Thinking)");
  });

  it("resolves 'gpt-oss'", () => {
    assert.equal(resolveModel("gpt-oss"), "GPT-OSS 120B (Medium)");
  });

  it("passes through unknown values verbatim (custom models in agy settings)", () => {
    assert.equal(resolveModel("My Custom Model"), "My Custom Model");
  });

  it("returns null for null input", () => {
    assert.equal(resolveModel(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(resolveModel(""), null);
  });

  it("is case-insensitive for aliases", () => {
    assert.equal(resolveModel("PRO"), "Gemini 3.1 Pro (High)");
    assert.equal(resolveModel("Flash"), "Gemini 3.5 Flash (High)");
  });
});

describe("DEFAULT_MODEL", () => {
  it("is Gemini 3.1 Pro (High)", () => {
    assert.equal(DEFAULT_MODEL, MODELS.PRO_HIGH);
    assert.equal(DEFAULT_MODEL, "Gemini 3.1 Pro (High)");
  });
});

describe("suggestAlternatives", () => {
  it("excludes aliases that map to the failed label", () => {
    const suggestions = suggestAlternatives(MODELS.PRO_HIGH);
    assert.ok(suggestions.length > 0);
    assert.ok(!suggestions.includes("pro"));
    assert.ok(!suggestions.includes("pro-high"));
    assert.ok(suggestions.includes("flash"));
  });

  it("returns all aliases when the failed label is unknown", () => {
    const suggestions = suggestAlternatives("unknown-model");
    assert.equal(suggestions.length, MODEL_ALIASES.size);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/models.test.mjs`
Expected: FAIL — old aliases (`gemini-3.1-pro-preview` etc.) don't match the new labels.

- [ ] **Step 3: Rewrite models.mjs**

`plugins/antigravity/scripts/lib/models.mjs` — full new content:

```js
// Model IDs are agy display labels — the only form `agy --model` resolves.
// Anything else silently falls back to agy's own default (Flash Medium);
// the facade detects that via the propagated label in agy's log.
export const MODELS = Object.freeze({
  PRO_HIGH: "Gemini 3.1 Pro (High)",
  PRO_LOW: "Gemini 3.1 Pro (Low)",
  FLASH_HIGH: "Gemini 3.5 Flash (High)",
  FLASH_MEDIUM: "Gemini 3.5 Flash (Medium)",
  FLASH_LOW: "Gemini 3.5 Flash (Low)",
  SONNET: "Claude Sonnet 4.6 (Thinking)",
  OPUS: "Claude Opus 4.6 (Thinking)",
  GPT_OSS: "GPT-OSS 120B (Medium)"
});

export const DEFAULT_MODEL = MODELS.PRO_HIGH;

export const MODEL_ALIASES = new Map([
  ["pro", MODELS.PRO_HIGH],
  ["pro-high", MODELS.PRO_HIGH],
  ["pro-low", MODELS.PRO_LOW],
  ["flash", MODELS.FLASH_HIGH],
  ["flash-high", MODELS.FLASH_HIGH],
  ["flash-medium", MODELS.FLASH_MEDIUM],
  ["flash-low", MODELS.FLASH_LOW],
  ["sonnet", MODELS.SONNET],
  ["opus", MODELS.OPUS],
  ["gpt-oss", MODELS.GPT_OSS]
]);

export function resolveModel(input) {
  if (input == null) {
    return null;
  }
  const normalized = String(input).trim();
  if (!normalized) {
    return null;
  }
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

export function suggestAlternatives(failedModelId) {
  const alternatives = [];
  for (const [alias, modelId] of MODEL_ALIASES) {
    if (modelId !== failedModelId) {
      alternatives.push(alias);
    }
  }
  if (alternatives.length === 0) {
    return [...MODEL_ALIASES.keys()];
  }
  return alternatives;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/models.test.mjs`
Expected: PASS.

Also run the full suite — `lib/antigravity.mjs` (still the old ACP facade) imports `resolveModel`/`DEFAULT_MODEL`/`suggestAlternatives`, whose signatures are unchanged:

Run: `node --test tests/*.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/models.test.mjs plugins/antigravity/scripts/lib/models.mjs
git commit -m "feat: switch model table to agy display labels, default Gemini 3.1 Pro (High)"
```

---

### Task 3: Fake agy fixture + `agy-cli.mjs` subprocess layer (TDD)

The new transport primitive. Pure addition — nothing imports it yet, so the suite stays green throughout.

**Files:**
- Create: `tests/fake-agy-fixture.mjs`
- Create: `plugins/antigravity/scripts/lib/agy-cli.mjs`
- Test: `tests/agy-cli.test.mjs`

- [ ] **Step 1: Write the fake agy fixture**

`tests/fake-agy-fixture.mjs` — full new content:

```js
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
 *            rate-limit | auth-error | hang
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
```

- [ ] **Step 2: Write the failing tests**

`tests/agy-cli.test.mjs` — full new content:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { createTempDir, cleanTempDir } from "./helpers.mjs";
import { installFakeAgy, FAKE_CONVERSATION_ID } from "./fake-agy-fixture.mjs";
import {
  buildAgyArgs,
  parseAgyLog,
  runAgyPrint
} from "../plugins/antigravity/scripts/lib/agy-cli.mjs";

describe("buildAgyArgs", () => {
  it("builds default args with print timeout", () => {
    const args = buildAgyArgs({ timeoutMs: 60_000 });
    assert.deepEqual(args, ["--print", "", "--print-timeout", "60s"]);
  });

  it("includes model, log file, conversation, and permissions flags", () => {
    const args = buildAgyArgs({
      modelLabel: "Gemini 3.1 Pro (High)",
      agyLogFile: "/tmp/x.log",
      conversationId: "abc",
      skipPermissions: true,
      timeoutMs: 1000
    });
    assert.equal(args[args.indexOf("--model") + 1], "Gemini 3.1 Pro (High)");
    assert.equal(args[args.indexOf("--log-file") + 1], "/tmp/x.log");
    assert.equal(args[args.indexOf("--conversation") + 1], "abc");
    assert.ok(args.includes("--dangerously-skip-permissions"));
  });

  it("rounds the timeout up to whole seconds", () => {
    const args = buildAgyArgs({ timeoutMs: 1500 });
    assert.equal(args[args.indexOf("--print-timeout") + 1], "2s");
  });
});

describe("parseAgyLog", () => {
  it("extracts the conversation id from fresh runs", () => {
    const log = "I0606 printmode.go:147] Print mode: conversation=" + FAKE_CONVERSATION_ID + ", sending message\n";
    assert.equal(parseAgyLog(log).conversationId, FAKE_CONVERSATION_ID);
  });

  it("extracts the conversation id from resumed runs", () => {
    const log = "I0606 printmode.go:147] Print mode: resuming conversation " + FAKE_CONVERSATION_ID + "\n";
    assert.equal(parseAgyLog(log).conversationId, FAKE_CONVERSATION_ID);
  });

  it("extracts the last propagated model label", () => {
    const log = [
      'I0606 ...] Propagating selected model override to backend: label="Gemini 3.5 Flash (Medium)"',
      'I0606 ...] Propagating selected model override to backend: label="Gemini 3.1 Pro (High)"'
    ].join("\n");
    assert.equal(parseAgyLog(log).resolvedModelLabel, "Gemini 3.1 Pro (High)");
  });

  it("returns nulls for empty logs", () => {
    assert.deepEqual(parseAgyLog(""), { conversationId: null, resolvedModelLabel: null });
  });
});

describe("runAgyPrint", () => {
  it("returns stdout and the parsed conversation id on success", async () => {
    const binDir = createTempDir("agy-cli-test-");
    try {
      const agyPath = installFakeAgy(binDir, "task-ok");
      const result = await runAgyPrint({
        prompt: "hello world",
        binary: agyPath,
        agyLogFile: path.join(binDir, "run.agy.log"),
        cwd: binDir,
        timeoutMs: 10_000
      });
      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes("TASK_COMPLETE: hello world"));
      assert.equal(result.conversationId, FAKE_CONVERSATION_ID);
      assert.equal(result.timedOut, false);
      assert.equal(result.spawnErrorMessage, null);
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("delivers the prompt via stdin and passes flags through", async () => {
    const binDir = createTempDir("agy-cli-test-");
    try {
      const agyPath = installFakeAgy(binDir, "echo-args");
      const result = await runAgyPrint({
        prompt: "the prompt body",
        modelLabel: "Gemini 3.1 Pro (High)",
        skipPermissions: true,
        binary: agyPath,
        agyLogFile: path.join(binDir, "run.agy.log"),
        cwd: binDir,
        timeoutMs: 10_000
      });
      const echoed = JSON.parse(result.stdout);
      assert.equal(echoed.prompt, "the prompt body");
      assert.equal(echoed.args[echoed.args.indexOf("--model") + 1], "Gemini 3.1 Pro (High)");
      assert.ok(echoed.args.includes("--dangerously-skip-permissions"));
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("detects silent model fallback", async () => {
    const binDir = createTempDir("agy-cli-test-");
    try {
      const agyPath = installFakeAgy(binDir, "model-fallback");
      const result = await runAgyPrint({
        prompt: "x",
        modelLabel: "Gemini 3.1 Pro (High)",
        binary: agyPath,
        agyLogFile: path.join(binDir, "run.agy.log"),
        cwd: binDir,
        timeoutMs: 10_000
      });
      assert.equal(result.modelFellBack, true);
      assert.equal(result.resolvedModelLabel, "Gemini 3.5 Flash (Medium)");
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("treats a matching propagated label as no fallback", async () => {
    const binDir = createTempDir("agy-cli-test-");
    try {
      const agyPath = installFakeAgy(binDir, "task-ok");
      const result = await runAgyPrint({
        prompt: "x",
        modelLabel: "Gemini 3.1 Pro (High)",
        binary: agyPath,
        agyLogFile: path.join(binDir, "run.agy.log"),
        cwd: binDir,
        timeoutMs: 10_000
      });
      assert.equal(result.modelFellBack, false);
      assert.equal(result.resolvedModelLabel, "Gemini 3.1 Pro (High)");
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("captures stderr and nonzero exit codes", async () => {
    const binDir = createTempDir("agy-cli-test-");
    try {
      const agyPath = installFakeAgy(binDir, "fail");
      const result = await runAgyPrint({
        prompt: "x",
        binary: agyPath,
        agyLogFile: path.join(binDir, "run.agy.log"),
        cwd: binDir,
        timeoutMs: 10_000
      });
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("boom"));
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("kills a hung agy via the watchdog", async () => {
    const binDir = createTempDir("agy-cli-test-");
    try {
      const agyPath = installFakeAgy(binDir, "hang");
      const result = await runAgyPrint({
        prompt: "x",
        binary: agyPath,
        agyLogFile: path.join(binDir, "run.agy.log"),
        cwd: binDir,
        timeoutMs: 300,
        watchdogGraceMs: 200
      });
      assert.equal(result.timedOut, true);
      assert.equal(result.ok, false);
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("falls back to the passed conversation id when resuming", async () => {
    const binDir = createTempDir("agy-cli-test-");
    try {
      const agyPath = installFakeAgy(binDir, "task-ok");
      const resumeId = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000";
      const result = await runAgyPrint({
        prompt: "x",
        conversationId: resumeId,
        binary: agyPath,
        agyLogFile: path.join(binDir, "run.agy.log"),
        cwd: binDir,
        timeoutMs: 10_000
      });
      assert.equal(result.conversationId, resumeId);
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("reports spawn failures without throwing", async () => {
    const result = await runAgyPrint({
      prompt: "x",
      binary: "/nonexistent/agy-not-here",
      timeoutMs: 5_000
    });
    assert.equal(result.ok, false);
    assert.ok(result.spawnErrorMessage);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/agy-cli.test.mjs`
Expected: FAIL — `Cannot find module '.../lib/agy-cli.mjs'`.

- [ ] **Step 4: Implement agy-cli.mjs**

`plugins/antigravity/scripts/lib/agy-cli.mjs` — full new content:

```js
import { spawn } from "node:child_process";
import fs from "node:fs";

export const DEFAULT_PRINT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_WATCHDOG_GRACE_MS = 30_000;
const SIGKILL_DELAY_MS = 5_000;
const MAX_LOG_READ_BYTES = 5 * 1024 * 1024;

// Matches both fresh runs ("Print mode: conversation=<uuid>, sending message")
// and resumed runs ("Print mode: resuming conversation <uuid>").
const CONVERSATION_RE = /Print mode: (?:resuming )?conversation[= ]([0-9a-f-]{36})/i;
const MODEL_LABEL_RE = /Propagating selected model override to backend: label="([^"]+)"/g;

let _activeChild = null;

/**
 * SIGTERM the currently running agy subprocess (if any).
 * Used by the facade's shutdown handler so /cancel's SIGTERM-to-worker chain
 * cleanly stops agy, which performs its own conversation cleanup.
 */
export function killActiveAgyChild(signal = "SIGTERM") {
  const child = _activeChild;
  if (child && child.exitCode === null && !child.killed) {
    try {
      child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function buildAgyArgs(options = {}) {
  const {
    modelLabel,
    conversationId,
    agyLogFile,
    timeoutMs = DEFAULT_PRINT_TIMEOUT_MS,
    skipPermissions = false
  } = options;

  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = ["--print", "", "--print-timeout", `${timeoutSeconds}s`];
  if (modelLabel) {
    args.push("--model", modelLabel);
  }
  if (agyLogFile) {
    args.push("--log-file", agyLogFile);
  }
  if (conversationId) {
    args.push("--conversation", conversationId);
  }
  if (skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  return args;
}

/**
 * Extract the conversation id and the last propagated model label from agy's
 * glog output. The conversation line appears as soon as the conversation
 * starts, so it survives cancellation and timeouts.
 */
export function parseAgyLog(logText) {
  const text = String(logText ?? "");
  const conversationMatch = text.match(CONVERSATION_RE);

  let resolvedModelLabel = null;
  MODEL_LABEL_RE.lastIndex = 0;
  for (let match = MODEL_LABEL_RE.exec(text); match !== null; match = MODEL_LABEL_RE.exec(text)) {
    resolvedModelLabel = match[1];
  }

  return {
    conversationId: conversationMatch ? conversationMatch[1] : null,
    resolvedModelLabel
  };
}

export function readAgyLog(agyLogFile) {
  if (!agyLogFile) {
    return "";
  }
  try {
    const stat = fs.statSync(agyLogFile);
    if (stat.size > MAX_LOG_READ_BYTES) {
      // Conversation/model lines appear early — the head is enough.
      const fd = fs.openSync(agyLogFile, "r");
      try {
        const buffer = Buffer.alloc(MAX_LOG_READ_BYTES);
        const bytes = fs.readSync(fd, buffer, 0, MAX_LOG_READ_BYTES, 0);
        return buffer.toString("utf8", 0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    }
    return fs.readFileSync(agyLogFile, "utf8");
  } catch {
    return "";
  }
}

/**
 * Run one agy print-mode invocation.
 *
 * @param {object} options
 * @param {string}  options.prompt           - written to stdin
 * @param {string}  [options.modelLabel]     - agy display label, passed to --model
 * @param {string}  [options.conversationId] - resume an existing conversation
 * @param {string}  [options.cwd]
 * @param {string}  [options.agyLogFile]     - per-run glog path (--log-file)
 * @param {number}  [options.timeoutMs]      - maps to --print-timeout; Node watchdog adds grace
 * @param {boolean} [options.skipPermissions]
 * @param {object}  [options.env]
 * @param {string}  [options.binary]
 * @param {number}  [options.watchdogGraceMs]
 * @returns {Promise<{ok: boolean, exitCode: number|null, stdout: string, stderr: string,
 *   conversationId: string|null, resolvedModelLabel: string|null, modelFellBack: boolean,
 *   timedOut: boolean, spawnErrorMessage: string|null}>}
 */
export function runAgyPrint(options = {}) {
  const {
    prompt,
    modelLabel,
    conversationId,
    cwd,
    agyLogFile,
    timeoutMs = DEFAULT_PRINT_TIMEOUT_MS,
    skipPermissions = false,
    env,
    binary = "agy",
    watchdogGraceMs = DEFAULT_WATCHDOG_GRACE_MS
  } = options;

  return new Promise((resolve) => {
    const args = buildAgyArgs({ modelLabel, conversationId, agyLogFile, timeoutMs, skipPermissions });
    const child = spawn(binary, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    _activeChild = child;

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer = null;

    const watchdog = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, SIGKILL_DELAY_MS);
      killTimer.unref?.();
    }, timeoutMs + watchdogGraceMs);
    watchdog.unref?.();

    function settle(extra = {}) {
      if (settled) {
        return;
      }
      settled = true;
      if (_activeChild === child) {
        _activeChild = null;
      }
      clearTimeout(watchdog);
      clearTimeout(killTimer);

      const parsed = parseAgyLog(readAgyLog(agyLogFile));
      const exitCode = extra.exitCode ?? null;
      const spawnErrorMessage = extra.spawnErrorMessage ?? null;

      resolve({
        ok: exitCode === 0 && !timedOut && !spawnErrorMessage,
        exitCode,
        stdout,
        stderr,
        conversationId: parsed.conversationId ?? conversationId ?? null,
        resolvedModelLabel: parsed.resolvedModelLabel,
        modelFellBack: Boolean(
          modelLabel && parsed.resolvedModelLabel && parsed.resolvedModelLabel !== modelLabel
        ),
        timedOut,
        spawnErrorMessage
      });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      settle({ spawnErrorMessage: err.message, exitCode: null });
    });

    child.on("close", (code) => {
      settle({ exitCode: code });
    });

    child.stdin.on("error", () => {
      // EPIPE when agy exits before consuming stdin — harmless.
    });
    child.stdin.write(String(prompt ?? ""));
    child.stdin.end();
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/agy-cli.test.mjs`
Expected: PASS (the watchdog test takes ~0.5-1s).

Run: `node --test tests/*.test.mjs`
Expected: PASS (pure addition).

- [ ] **Step 6: Commit**

```bash
git add tests/fake-agy-fixture.mjs tests/agy-cli.test.mjs plugins/antigravity/scripts/lib/agy-cli.mjs
git commit -m "feat: add agy print-mode subprocess layer with log parsing and watchdog"
```

---

### Task 4: Review worktree isolation (TDD)

agy has no read-only mode, so reviews run inside a disposable detached git worktree mirroring the working state. Pure addition — nothing imports it yet.

**Files:**
- Create: `plugins/antigravity/scripts/lib/review-worktree.mjs`
- Test: `tests/review-worktree.test.mjs`

- [ ] **Step 1: Write the failing tests**

`tests/review-worktree.test.mjs` — full new content:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createTempDir, cleanTempDir, initGitRepo, writeFile } from "./helpers.mjs";
import {
  createReviewWorktree,
  sweepOrphanedWorktrees,
  WORKTREE_PREFIX
} from "../plugins/antigravity/scripts/lib/review-worktree.mjs";

let repoDir;

function gitListWorktrees(cwd) {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  return result.stdout ?? "";
}

describe("createReviewWorktree", () => {
  beforeEach(() => {
    repoDir = createTempDir("worktree-test-");
    initGitRepo(repoDir);
  });

  afterEach(() => {
    sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
    cleanTempDir(repoDir);
  });

  it("creates a detached worktree containing committed files", () => {
    const worktree = createReviewWorktree(repoDir, "plantest1");
    try {
      assert.ok(fs.existsSync(path.join(worktree.path, "README.md")));
      assert.ok(path.basename(worktree.path).startsWith(WORKTREE_PREFIX));
    } finally {
      worktree.cleanup();
    }
  });

  it("mirrors modified tracked files into the worktree", () => {
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Modified\n");
    const worktree = createReviewWorktree(repoDir, "plantest2");
    try {
      assert.equal(fs.readFileSync(path.join(worktree.path, "README.md"), "utf8"), "# Modified\n");
      assert.deepEqual(worktree.warnings, []);
    } finally {
      worktree.cleanup();
    }
  });

  it("mirrors untracked files into the worktree", () => {
    writeFile(repoDir, "new-file.txt", "untracked content\n");
    const worktree = createReviewWorktree(repoDir, "plantest3");
    try {
      assert.equal(fs.readFileSync(path.join(worktree.path, "new-file.txt"), "utf8"), "untracked content\n");
    } finally {
      worktree.cleanup();
    }
  });

  it("cleanup removes the worktree directory and registration", () => {
    const worktree = createReviewWorktree(repoDir, "plantest4");
    worktree.cleanup();
    assert.equal(fs.existsSync(worktree.path), false);
    assert.ok(!gitListWorktrees(repoDir).includes(path.basename(worktree.path)));
  });

  it("throws for non-git directories", () => {
    const plainDir = createTempDir("not-a-repo-");
    try {
      assert.throws(() => createReviewWorktree(plainDir, "plantest5"), /worktree add failed/);
    } finally {
      cleanTempDir(plainDir);
    }
  });
});

describe("sweepOrphanedWorktrees", () => {
  beforeEach(() => {
    repoDir = createTempDir("sweep-test-");
    initGitRepo(repoDir);
  });

  afterEach(() => {
    sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
    cleanTempDir(repoDir);
  });

  it("removes aged agy-review worktrees", () => {
    const aged = createReviewWorktree(repoDir, "agedplan1");
    const removed = sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
    assert.ok(removed.some((p) => p.includes("agedplan1")));
    assert.equal(fs.existsSync(aged.path), false);
  });

  it("keeps fresh agy-review worktrees", () => {
    const fresh = createReviewWorktree(repoDir, "freshplan1");
    try {
      const removed = sweepOrphanedWorktrees(repoDir, { maxAgeMs: 60_000 });
      assert.ok(!removed.some((p) => p.includes("freshplan1")));
      assert.ok(fs.existsSync(fresh.path));
    } finally {
      fresh.cleanup();
    }
  });

  it("does not touch worktrees without the agy-review prefix", () => {
    const unrelatedPath = path.join(os.tmpdir(), `regular-wt-${process.pid}-${Date.now()}`);
    const add = spawnSync("git", ["worktree", "add", "--detach", unrelatedPath, "HEAD"], {
      cwd: repoDir,
      encoding: "utf8"
    });
    assert.equal(add.status, 0, add.stderr);
    try {
      sweepOrphanedWorktrees(repoDir, { maxAgeMs: 0 });
      assert.ok(fs.existsSync(unrelatedPath));
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", unrelatedPath], { cwd: repoDir });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/review-worktree.test.mjs`
Expected: FAIL — `Cannot find module '.../lib/review-worktree.mjs'`.

- [ ] **Step 3: Implement review-worktree.mjs**

`plugins/antigravity/scripts/lib/review-worktree.mjs` — full new content:

```js
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./process.mjs";

export const WORKTREE_PREFIX = "agy-review-";
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function git(args, cwd, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}

function realTmpDir() {
  // macOS: os.tmpdir() is /var/... but git reports the /private/var/... realpath.
  try {
    return fs.realpathSync(os.tmpdir());
  } catch {
    return path.resolve(os.tmpdir());
  }
}

/**
 * Copy the workspace's uncommitted state into the worktree (best effort):
 * tracked changes via `git diff HEAD --binary | git apply`, untracked
 * non-ignored files via direct copy. Returns warning strings for anything
 * that could not be mirrored — the review prompt already embeds the diff,
 * so mirroring failures degrade fidelity, not correctness.
 */
export function mirrorWorkingState(workspaceRoot, worktreePath) {
  const warnings = [];

  const diff = git(["diff", "HEAD", "--binary"], workspaceRoot);
  if (diff.status === 0 && diff.stdout.trim()) {
    const apply = git(["apply", "--whitespace=nowarn"], worktreePath, { input: diff.stdout });
    if (apply.status !== 0) {
      warnings.push(
        `could not mirror uncommitted changes: ${(apply.stderr || apply.stdout).trim().slice(0, 200)}`
      );
    }
  } else if (diff.status !== 0) {
    warnings.push(`could not compute working-tree diff: ${(diff.stderr || "").trim().slice(0, 200)}`);
  }

  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], workspaceRoot);
  if (untracked.status === 0 && untracked.stdout) {
    for (const relPath of untracked.stdout.split("\0").filter(Boolean)) {
      try {
        const source = path.join(workspaceRoot, relPath);
        const destination = path.join(worktreePath, relPath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
      } catch {
        warnings.push(`could not copy untracked file: ${relPath}`);
      }
    }
  }

  return warnings;
}

/**
 * Create a disposable detached worktree at HEAD under the OS temp dir and
 * mirror the current working state into it.
 *
 * @param {string} workspaceRoot - git repository root
 * @param {string|null} id - job id for background reviews; random for foreground
 * @returns {{ path: string, warnings: string[], cleanup: () => void }}
 */
export function createReviewWorktree(workspaceRoot, id = null) {
  const worktreeId = id ?? crypto.randomBytes(4).toString("hex");
  const worktreePath = path.join(os.tmpdir(), `${WORKTREE_PREFIX}${worktreeId}`);

  const add = git(["worktree", "add", "--detach", worktreePath, "HEAD"], workspaceRoot);
  if (add.status !== 0) {
    throw new Error(`git worktree add failed: ${(add.stderr || add.stdout).trim().slice(0, 300)}`);
  }

  const warnings = mirrorWorkingState(workspaceRoot, worktreePath);

  function cleanup() {
    const remove = git(["worktree", "remove", "--force", worktreePath], workspaceRoot);
    if (remove.status !== 0) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        // best effort
      }
      git(["worktree", "prune"], workspaceRoot);
    }
  }

  return { path: worktreePath, warnings, cleanup };
}

/**
 * Remove agy-review-* worktrees older than maxAgeMs (default 24h) — covers
 * workers that died without running cleanup (e.g. SIGKILL). Only touches
 * worktrees whose directory sits directly in the OS temp dir AND whose name
 * starts with the agy-review- prefix; never touches user worktrees.
 */
export function sweepOrphanedWorktrees(workspaceRoot, options = {}) {
  const maxAgeMs = options.maxAgeMs ?? ORPHAN_MAX_AGE_MS;
  const tmpRoot = realTmpDir();
  const removed = [];

  const list = git(["worktree", "list", "--porcelain"], workspaceRoot);
  if (list.status !== 0) {
    return removed;
  }

  const worktreePaths = list.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());

  for (const worktreePath of worktreePaths) {
    const isOurs =
      path.basename(worktreePath).startsWith(WORKTREE_PREFIX) &&
      path.dirname(worktreePath) === tmpRoot;
    if (!isOurs) {
      continue;
    }

    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(worktreePath).mtimeMs;
    } catch {
      mtimeMs = 0; // directory already gone — remove the stale registration
    }
    if (Date.now() - mtimeMs < maxAgeMs) {
      continue;
    }

    const remove = git(["worktree", "remove", "--force", worktreePath], workspaceRoot);
    if (remove.status === 0) {
      removed.push(worktreePath);
    }
  }

  git(["worktree", "prune"], workspaceRoot);
  return removed;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-worktree.test.mjs`
Expected: PASS. If the "does not touch worktrees without the prefix" test fails on macOS, the cause is the `/var` vs `/private/var` symlink — `realTmpDir()` handles it; verify `path.dirname(worktreePath) === tmpRoot` compares canonical paths on your machine.

Run: `node --test tests/*.test.mjs`
Expected: PASS (pure addition).

- [ ] **Step 5: Commit**

```bash
git add tests/review-worktree.test.mjs plugins/antigravity/scripts/lib/review-worktree.mjs
git commit -m "feat: add disposable git worktree isolation for reviews"
```

---

### Task 5: The swap — facade, companion, hooks, ACP deletion

Replaces the ACP facade with the agy-backed one, updates the companion + hooks, deletes all ACP code/tests, and rewrites the integration tests. This task is atomic by nature (the transport swap can't be half-done), so it has many steps but one commit.

**Files:**
- Rewrite: `plugins/antigravity/scripts/lib/antigravity.mjs`
- Modify: `plugins/antigravity/scripts/antigravity-companion.mjs` (imports, handleSetup, symbol names)
- Modify: `plugins/antigravity/scripts/lib/tracked-jobs.mjs` (SESSION_ID_ENV value)
- Modify: `plugins/antigravity/scripts/session-lifecycle-hook.mjs` (SESSION_ID_ENV value)
- Modify: `plugins/antigravity/scripts/stop-review-gate-hook.mjs` (import symbol)
- Modify: `plugins/antigravity/scripts/lib/state.mjs` (fallback state dir)
- Modify: `plugins/antigravity/scripts/lib/fs.mjs` (temp dir prefix)
- Modify: `plugins/antigravity/scripts/lib/render.mjs` (renderSetupReport shape only)
- Delete: `plugins/antigravity/scripts/lib/acp-client.mjs`, `acp-lifecycle.mjs`, `acp-protocol.d.ts`
- Delete: `tests/acp-client.test.mjs`, `tests/acp-lifecycle.test.mjs`, `tests/acp-security.test.mjs`, `tests/extract-result-text.test.mjs`, `tests/fake-gemini-fixture.mjs`
- Rewrite: `tests/runtime.test.mjs`
- Create: `tests/antigravity.test.mjs`
- Modify: `tests/render.test.mjs` (renderSetupReport block only — rest is Task 6)

- [ ] **Step 1: Rewrite the facade**

`plugins/antigravity/scripts/lib/antigravity.mjs` — full new content:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runAgyPrint,
  killActiveAgyChild,
  parseAgyLog,
  readAgyLog,
  DEFAULT_PRINT_TIMEOUT_MS
} from "./agy-cli.mjs";
import { createReviewWorktree, sweepOrphanedWorktrees } from "./review-worktree.mjs";
import { DEFAULT_MODEL, resolveModel, suggestAlternatives } from "./models.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";
import { createTempDir, readJsonFile } from "./fs.mjs";
import { appendLogBlock, appendLogLine } from "./tracked-jobs.mjs";
import { upsertJob } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

// ---------------------------------------------------------------------------
// Shutdown handling (SIGTERM-based cancellation)
// ---------------------------------------------------------------------------

/**
 * Install a SIGTERM/SIGINT handler for background workers. /cancel SIGTERMs
 * the worker PID; this handler SIGTERMs the active agy subprocess, which does
 * its own graceful conversation cleanup. The in-flight runAgyPrint then
 * resolves through its normal close path, so the worker persists partial
 * output before exiting naturally.
 */
export function installShutdownHandler() {
  let shuttingDown = false;

  const handler = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const killed = killActiveAgyChild("SIGTERM");
    if (!killed) {
      // No active agy run — exit directly.
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

export function getAntigravityAvailability(cwd) {
  return binaryAvailable("agy", ["--version"], { cwd });
}

export function getAntigravityAuthStatus() {
  const geminiDir = path.join(os.homedir(), ".gemini");
  for (const marker of ["oauth_creds.json", "google_accounts.json"]) {
    if (fs.existsSync(path.join(geminiDir, marker))) {
      return { available: true, loggedIn: true, detail: "authenticated (Google account)" };
    }
  }
  return {
    available: true,
    loggedIn: false,
    detail: "not authenticated. Run agy interactively once and complete sign-in"
  };
}

// ---------------------------------------------------------------------------
// Structured output parser (3-strategy: direct → fence → brace) — unchanged
// ---------------------------------------------------------------------------

export function parseStructuredOutput(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) {
    return { parsed: null, parseError: "Empty response text", rawOutput: "" };
  }

  try {
    const data = JSON.parse(text);
    return { parsed: data, parseError: null, rawOutput: text };
  } catch {
    // continue
  }

  const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      const data = JSON.parse(jsonBlockMatch[1].trim());
      return { parsed: data, parseError: null, rawOutput: text };
    } catch {
      // continue
    }
  }

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
    parseError: "Could not extract JSON from Antigravity response",
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
// Output post-processing helpers
// ---------------------------------------------------------------------------

/**
 * Strip an absolute path prefix (e.g. the review worktree) from model output
 * so findings reference repo-relative paths. Handles the macOS
 * /var ↔ /private/var symlink in both directions.
 */
export function stripPathPrefix(text, prefix) {
  if (!text || !prefix) {
    return text ?? "";
  }
  const variants = new Set([prefix]);
  if (prefix.startsWith("/private/")) {
    variants.add(prefix.slice("/private".length));
  } else if (prefix.startsWith("/")) {
    variants.add(`/private${prefix}`);
  }

  let result = text;
  for (const variant of variants) {
    result = result.split(`${variant}/`).join("");
    result = result.split(variant).join(".");
  }
  return result;
}

function captureGitStatus(cwd) {
  const status = runCommand("git", ["status", "--porcelain"], { cwd });
  return status.status === 0 ? status.stdout : null;
}

/** Lines present in `after` but not in `before` (both `git status --porcelain`). */
export function detectWorkingTreeDelta(before, after) {
  if (before == null || after == null || before === after) {
    return [];
  }
  const beforeLines = new Set(before.split("\n").filter(Boolean));
  return after.split("\n").filter(Boolean).filter((line) => !beforeLines.has(line));
}

// ---------------------------------------------------------------------------
// Task execution (agy print mode)
// ---------------------------------------------------------------------------

const READ_ONLY_GUARD =
  "IMPORTANT: You are running in READ-ONLY mode. Do not create, modify, or delete any files, " +
  "and do not run commands that change repository or system state. If a change would be needed, describe it instead.";

const RATE_LIMIT_RE = /429|RESOURCE_EXHAUSTED|capacity|rate.?limit/i;
const AUTH_FAILURE_RE = /not logged in|authentication failed/i;

const CONVERSATION_WATCH_INTERVAL_MS = 500;

/**
 * Poll the agy log for the conversation id while the run is in flight, so a
 * hard-killed worker still leaves a resumable id in job state (parity with
 * the old "persist sessionId immediately" ACP behavior).
 */
function watchConversationId(agyLogFile, onFound) {
  if (!agyLogFile) {
    return () => {};
  }
  let stopped = false;
  const timer = setInterval(() => {
    const { conversationId } = parseAgyLog(readAgyLog(agyLogFile));
    if (conversationId) {
      stop();
      onFound(conversationId);
    }
  }, CONVERSATION_WATCH_INTERVAL_MS);
  timer.unref?.();

  function stop() {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
    }
  }
  return stop;
}

/**
 * Run an Antigravity task via agy print mode.
 *
 * @param {string} cwd - working directory for agy
 * @param {object} options
 * @param {string}  options.prompt
 * @param {string}  [options.model]    - alias or agy display label
 * @param {boolean} [options.write=true]
 * @param {string}  [options.resume]   - existing conversation id to resume
 * @param {string}  [options.logFile]
 * @param {Function} [options.onProgress]
 * @param {object}  [options.env]
 * @param {string}  [options.jobId]
 * @param {string}  [options.workspaceRoot]
 * @param {number}  [options.timeoutMs]
 * @param {boolean} [options.skipWriteDetection] - internal: review path is already isolated
 * @param {string}  [options.binary]   - test override for the agy binary
 * @returns {Promise<{ok: boolean, rawOutput: string, sessionId: string|null, stopReason: string|null, failureMessage: string|null}>}
 */
export async function runAntigravityTask(cwd, options = {}) {
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
    timeoutMs,
    skipWriteDetection = false,
    binary
  } = options;

  const resolvedModel = resolveModel(model) ?? DEFAULT_MODEL;
  const effectiveWorkspaceRoot = workspaceRoot ?? resolveWorkspaceRoot(cwd);
  const agyLogFile = logFile
    ? `${logFile}.agy.log`
    : path.join(os.tmpdir(), `agy-print-${process.pid}-${Date.now()}.log`);

  const preStatus = !write && !skipWriteDetection ? captureGitStatus(cwd) : null;
  const effectivePrompt = write ? prompt : `${READ_ONLY_GUARD}\n\n${prompt}`;

  appendLogLine(logFile, resume ? `Resuming agy conversation ${resume}` : `Starting agy (${resolvedModel})`);
  onProgress?.({ message: "agy running...", phase: "running" });

  function persistConversationId(conversationId) {
    if (jobId && effectiveWorkspaceRoot) {
      try {
        upsertJob(effectiveWorkspaceRoot, { id: jobId, sessionId: conversationId });
      } catch {
        // non-fatal — state write may fail in edge cases
      }
    }
  }

  const stopWatching = watchConversationId(agyLogFile, persistConversationId);

  let run;
  try {
    run = await runAgyPrint({
      prompt: effectivePrompt,
      modelLabel: resolvedModel,
      conversationId: resume,
      cwd,
      env,
      agyLogFile,
      timeoutMs: timeoutMs ?? DEFAULT_PRINT_TIMEOUT_MS,
      skipPermissions: write,
      ...(binary ? { binary } : {})
    });
  } finally {
    stopWatching();
  }

  if (run.stdout) {
    appendLogBlock(logFile, "Final output", run.stdout);
  }
  if (run.conversationId) {
    persistConversationId(run.conversationId);
  }

  if (run.spawnErrorMessage) {
    return {
      ok: false,
      rawOutput: "",
      sessionId: null,
      stopReason: "error",
      failureMessage: `Failed to start agy: ${run.spawnErrorMessage}`
    };
  }

  if (run.timedOut) {
    const seconds = Math.round((timeoutMs ?? DEFAULT_PRINT_TIMEOUT_MS) / 1000);
    return {
      ok: false,
      rawOutput: run.stdout,
      sessionId: run.conversationId,
      stopReason: "timeout",
      failureMessage: `agy timed out after ${seconds}s.`
    };
  }

  if (run.modelFellBack) {
    const requested = model ?? resolvedModel;
    const alternatives = suggestAlternatives(run.resolvedModelLabel);
    const suggestion = alternatives.length > 0 ? ` Try: --model ${alternatives[0]}` : "";
    return {
      ok: false,
      rawOutput: run.stdout,
      sessionId: run.conversationId,
      stopReason: "error",
      failureMessage: `Model "${requested}" was not recognized by agy; it fell back to "${run.resolvedModelLabel}".${suggestion}`
    };
  }

  if (run.exitCode !== 0) {
    const haystack = `${run.stderr}\n${readAgyLog(agyLogFile).slice(-4096)}`;
    let failureMessage;
    if (RATE_LIMIT_RE.test(haystack)) {
      const alternatives = suggestAlternatives(resolvedModel);
      const suggestion = alternatives.length > 0 ? ` Try: --model ${alternatives[0]}` : "";
      failureMessage = `Model "${model ?? "default"}" hit rate limits.${suggestion}`;
    } else if (AUTH_FAILURE_RE.test(haystack)) {
      failureMessage = "agy is not authenticated. Run agy interactively once and complete sign-in.";
    } else {
      const detail = run.stderr.trim().slice(0, 500);
      failureMessage = detail
        ? `agy exited with code ${run.exitCode}: ${detail}`
        : `agy exited with code ${run.exitCode}.`;
    }
    return {
      ok: false,
      rawOutput: run.stdout,
      sessionId: run.conversationId,
      stopReason: "error",
      failureMessage
    };
  }

  let rawOutput = run.stdout;

  if (preStatus != null) {
    const delta = detectWorkingTreeDelta(preStatus, captureGitStatus(cwd));
    if (delta.length > 0) {
      const warning = [
        "WARNING: this read-only task modified the working tree:",
        ...delta.map((line) => `  ${line}`),
        "Review these changes with `git status` / `git diff` and revert anything unwanted.",
        ""
      ].join("\n");
      rawOutput = `${warning}\n${rawOutput}`;
      appendLogLine(logFile, `read-only violation: ${delta.length} path(s) changed`);
    }
  }

  return {
    ok: true,
    rawOutput,
    sessionId: run.conversationId,
    stopReason: "end_turn",
    failureMessage: null
  };
}

// ---------------------------------------------------------------------------
// Review execution (worktree-isolated)
// ---------------------------------------------------------------------------

/**
 * Run an Antigravity review. The review context is fully embedded in the
 * prompt; agy executes inside a disposable git worktree mirroring the working
 * state, so the model can read repo files while stray writes land in the
 * throwaway worktree.
 *
 * @returns {Promise<{ok: boolean, parsed: object|null, parseError: string|null, rawOutput: string, sessionId: string|null, reasoningSummary: string|null}>}
 */
export async function runAntigravityReview(cwd, options = {}) {
  const { prompt, model, timeoutMs, logFile, onProgress, env, workspaceRoot, jobId, binary } = options;
  const effectiveWorkspaceRoot = workspaceRoot ?? resolveWorkspaceRoot(cwd);

  try {
    sweepOrphanedWorktrees(effectiveWorkspaceRoot);
  } catch {
    // best-effort housekeeping
  }

  let isolation = null;
  let isolationNote = null;
  try {
    isolation = createReviewWorktree(effectiveWorkspaceRoot, jobId ?? null);
    for (const warning of isolation.warnings) {
      appendLogLine(logFile, `worktree: ${warning}`);
    }
  } catch (err) {
    appendLogLine(logFile, `worktree creation failed: ${err.message}`);
    isolationNote =
      "Note: the reviewer had no repository file access (worktree creation failed); findings are based on the embedded diff context only.";
  }

  const execCwd = isolation ? isolation.path : createTempDir("agy-review-");

  let taskResult;
  try {
    taskResult = await runAntigravityTask(execCwd, {
      prompt,
      model,
      write: false,
      skipWriteDetection: true,
      logFile,
      onProgress,
      env,
      workspaceRoot: effectiveWorkspaceRoot,
      timeoutMs,
      jobId,
      ...(binary ? { binary } : {})
    });
  } finally {
    if (isolation) {
      isolation.cleanup();
    } else {
      try {
        fs.rmSync(execCwd, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }

  const rawOutput = stripPathPrefix(taskResult.rawOutput, execCwd);

  if (!taskResult.ok) {
    return {
      ok: false,
      parsed: null,
      parseError: taskResult.failureMessage,
      rawOutput,
      sessionId: taskResult.sessionId,
      reasoningSummary: null
    };
  }

  const structured = parseStructuredOutput(rawOutput);
  if (isolationNote) {
    if (structured.parsed && typeof structured.parsed.summary === "string") {
      structured.parsed.summary = `${isolationNote} ${structured.parsed.summary}`;
    } else {
      structured.rawOutput = `${isolationNote}\n\n${structured.rawOutput}`;
    }
  }

  return {
    ok: true,
    ...structured,
    sessionId: taskResult.sessionId,
    reasoningSummary: null
  };
}
```

- [ ] **Step 2: Update the companion**

In `plugins/antigravity/scripts/antigravity-companion.mjs`:

(a) Update the facade import block:

```js
// old
import {
  getGeminiAvailability,
  getGeminiAuthStatus,
  runGeminiReview,
  runGeminiTask,
  readOutputSchema,
  findLatestTaskSession,
  installShutdownHandler
} from "./lib/antigravity.mjs";
// new
import {
  getAntigravityAvailability,
  getAntigravityAuthStatus,
  runAntigravityReview,
  runAntigravityTask,
  readOutputSchema,
  findLatestTaskSession,
  installShutdownHandler
} from "./lib/antigravity.mjs";
```

(b) Replace every call site: `runGeminiReview(` → `runAntigravityReview(` (2 places: `executeReviewForeground`, `handleReviewWorker`) and `runGeminiTask(` → `runAntigravityTask(` (2 places: `executeTask` foreground, `handleTaskWorker`).

(c) Replace `handleSetup` entirely (agy is not npm-installable, so the npm check and install suggestion go away):

```js
function handleSetup(cwd, argv) {
  const { options } = parseArgs(argv, {
    booleanOptions: new Set(["json", "enable-review-gate", "disable-review-gate"]),
    aliasMap: {}
  });

  const workspaceRoot = resolveWorkspaceRoot(cwd);

  // Toggle review gate if requested
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  }
  if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }

  const nodeStatus = binaryAvailable("node");
  const agyStatus = getAntigravityAvailability(cwd);
  const authStatus = agyStatus.available
    ? getAntigravityAuthStatus()
    : { available: false, loggedIn: false, detail: "agy not installed" };
  const config = getConfig(workspaceRoot);

  const report = {
    ready: agyStatus.available && authStatus.loggedIn,
    node: nodeStatus,
    agy: agyStatus,
    auth: authStatus,
    sessionRuntime: { label: "direct" },
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken: [],
    nextSteps: []
  };

  if (!agyStatus.available) {
    report.nextSteps.push("Install the Antigravity CLI (agy): https://antigravity.google");
  }
  if (agyStatus.available && !authStatus.loggedIn) {
    report.nextSteps.push("Authenticate: run agy interactively once and complete sign-in");
  }

  const output = options.json ? JSON.stringify(report, null, 2) : renderSetupReport(report);
  process.stdout.write(output);
}
```

- [ ] **Step 3: Update renderSetupReport for the new report shape**

In `plugins/antigravity/scripts/lib/render.mjs`, replace the checks block of `renderSetupReport` (npm line dropped, gemini → agy, title updated now since the shape changes anyway):

```js
// old
  const lines = [
    "# Gemini Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- npm: ${report.npm.detail}`,
    `- gemini: ${report.gemini.detail}`,
    `- auth: ${report.auth.detail}`,
    `- session runtime: ${report.sessionRuntime.label}`,
    `- review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`,
    ""
  ];
// new
  const lines = [
    "# Antigravity Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- agy: ${report.agy.detail}`,
    `- auth: ${report.auth.detail}`,
    `- session runtime: ${report.sessionRuntime.label}`,
    `- review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`,
    ""
  ];
```

And update the `renderSetupReport` block in `tests/render.test.mjs` to match (only this describe block — the rest of render.test changes in Task 6):

```js
describe("renderSetupReport", () => {
  it("renders ready status", () => {
    const output = renderSetupReport({
      ready: true,
      node: { available: true, detail: "v22.0.0" },
      agy: { available: true, detail: "1.0.6" },
      auth: { available: true, loggedIn: true, detail: "authenticated (Google account)" },
      sessionRuntime: { label: "direct" },
      reviewGateEnabled: false,
      actionsTaken: [],
      nextSteps: []
    });
    assert.ok(output.includes("# Antigravity Setup"));
    assert.ok(output.includes("Status: ready"));
    assert.ok(output.includes("agy: 1.0.6"));
  });

  it("renders needs-attention status", () => {
    const output = renderSetupReport({
      ready: false,
      node: { available: true, detail: "v22.0.0" },
      agy: { available: false, detail: "not found" },
      auth: { available: false, loggedIn: false, detail: "agy not installed" },
      sessionRuntime: { label: "direct" },
      reviewGateEnabled: false,
      actionsTaken: [],
      nextSteps: ["Install the Antigravity CLI (agy): https://antigravity.google"]
    });
    assert.ok(output.includes("Status: needs attention"));
    assert.ok(output.includes("Install the Antigravity CLI"));
  });
});
```

- [ ] **Step 4: Env var, state dir, temp prefix renames**

`plugins/antigravity/scripts/lib/tracked-jobs.mjs`:

```js
// old
export const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";
// new
export const SESSION_ID_ENV = "ANTIGRAVITY_COMPANION_SESSION_ID";
```

`plugins/antigravity/scripts/session-lifecycle-hook.mjs` (it has its own copy):

```js
// old
export const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";
// new
export const SESSION_ID_ENV = "ANTIGRAVITY_COMPANION_SESSION_ID";
```

`plugins/antigravity/scripts/lib/state.mjs`:

```js
// old
const FALLBACK_STATE_ROOT_DIR = "gemini-companion";
// new
const FALLBACK_STATE_ROOT_DIR = "antigravity-companion";
```

`plugins/antigravity/scripts/lib/fs.mjs`:

```js
// old
export function createTempDir(prefix = "gemini-plugin-") {
// new
export function createTempDir(prefix = "antigravity-plugin-") {
```

`plugins/antigravity/scripts/stop-review-gate-hook.mjs`:

```js
// old
import { getGeminiAuthStatus } from "./lib/antigravity.mjs";
// new
import { getAntigravityAuthStatus } from "./lib/antigravity.mjs";
```

and its use in `buildSetupNote()`:

```js
// old
  const authStatus = getGeminiAuthStatus();
// new
  const authStatus = getAntigravityAuthStatus();
```

(The hook's user-facing prose changes in Task 6.)

- [ ] **Step 5: Delete the ACP layer and its tests**

```bash
git rm plugins/antigravity/scripts/lib/acp-client.mjs \
       plugins/antigravity/scripts/lib/acp-lifecycle.mjs \
       plugins/antigravity/scripts/lib/acp-protocol.d.ts \
       tests/acp-client.test.mjs \
       tests/acp-lifecycle.test.mjs \
       tests/acp-security.test.mjs \
       tests/extract-result-text.test.mjs \
       tests/fake-gemini-fixture.mjs
```

- [ ] **Step 6: Rewrite the integration tests**

`tests/runtime.test.mjs` — full new content:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createTempDir, cleanTempDir, initGitRepo, runCompanion } from "./helpers.mjs";
import { installFakeAgy, createFakeAgyEnv, removeFakeAgy } from "./fake-agy-fixture.mjs";

let tmpDir;
let binDir;
let fakeEnv;

describe("runtime integration", () => {
  beforeEach(() => {
    tmpDir = createTempDir("runtime-test-");
    binDir = createTempDir("fake-bin-");
    initGitRepo(tmpDir);
    installFakeAgy(binDir, "task-ok");
    fakeEnv = createFakeAgyEnv(binDir);
  });

  afterEach(() => {
    cleanTempDir(tmpDir);
    removeFakeAgy(binDir);
  });

  it("setup reports ready with fake agy", () => {
    const result = runCompanion(["setup", "--json"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, true);
    assert.equal(report.agy.available, true);
    assert.equal(report.auth.loggedIn, true);
  });

  it("setup detects missing agy", () => {
    const noAgyEnv = { ...fakeEnv, PATH: "/nonexistent" };
    const result = runCompanion(["setup", "--json"], { cwd: tmpDir, env: noAgyEnv });
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, false);
    assert.equal(report.agy.available, false);
    assert.ok(report.nextSteps.some((step) => step.includes("Install the Antigravity CLI")));
  });

  it("status shows no jobs initially", () => {
    const result = runCompanion(["status"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("No jobs recorded yet"));
  });

  it("unknown command returns error", () => {
    const result = runCompanion(["nonsense"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("Unknown command"));
  });

  it("task with no prompt returns error", () => {
    const result = runCompanion(["task"], { cwd: tmpDir, env: fakeEnv });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("No task prompt"));
  });

  it("task --wait completes with fake agy", () => {
    const result = runCompanion(["task", "--wait", "test task"], {
      cwd: tmpDir,
      env: fakeEnv,
      timeout: 30_000
    });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes("TASK_COMPLETE"), `expected task output, got: ${result.stdout.slice(0, 200)}`);
  });

  it("review --wait completes with fake agy and renders findings", () => {
    const reviewBinDir = createTempDir("fake-bin-review-");
    installFakeAgy(reviewBinDir, "review-ok");
    const reviewEnv = createFakeAgyEnv(reviewBinDir);
    try {
      const result = runCompanion(["review", "--wait"], { cwd: tmpDir, env: reviewEnv, timeout: 30_000 });
      assert.equal(result.status, 0);
      assert.ok(result.stdout.length > 0, "stdout should be non-empty");
      assert.ok(
        result.stdout.includes("Verdict") || result.stdout.includes("needs-attention"),
        `expected review output, got: ${result.stdout.slice(0, 200)}`
      );
    } finally {
      removeFakeAgy(reviewBinDir);
    }
  });

  it("task failure surfaces the agy error", () => {
    const failBinDir = createTempDir("fake-bin-fail-");
    installFakeAgy(failBinDir, "fail");
    const failEnv = createFakeAgyEnv(failBinDir);
    try {
      const result = runCompanion(["task", "--wait", "doomed task"], {
        cwd: tmpDir,
        env: failEnv,
        timeout: 30_000
      });
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes("agy exited with code 1"), `got: ${result.stdout.slice(0, 200)}`);
    } finally {
      removeFakeAgy(failBinDir);
    }
  });
});
```

`tests/antigravity.test.mjs` — full new content (unit tests for the facade's pure helpers):

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseStructuredOutput,
  stripPathPrefix,
  detectWorkingTreeDelta
} from "../plugins/antigravity/scripts/lib/antigravity.mjs";

describe("parseStructuredOutput", () => {
  it("parses direct JSON", () => {
    const result = parseStructuredOutput('{"verdict":"approve"}');
    assert.deepEqual(result.parsed, { verdict: "approve" });
    assert.equal(result.parseError, null);
  });

  it("parses JSON inside a fenced code block", () => {
    const result = parseStructuredOutput('Here you go:\n```json\n{"verdict":"approve"}\n```\nDone.');
    assert.deepEqual(result.parsed, { verdict: "approve" });
  });

  it("parses JSON between braces in prose", () => {
    const result = parseStructuredOutput('The answer is {"verdict":"approve"} as requested.');
    assert.deepEqual(result.parsed, { verdict: "approve" });
  });

  it("returns a parse error for non-JSON text", () => {
    const result = parseStructuredOutput("no json here");
    assert.equal(result.parsed, null);
    assert.ok(result.parseError.includes("Could not extract JSON"));
  });

  it("returns a parse error for empty text", () => {
    const result = parseStructuredOutput("");
    assert.equal(result.parsed, null);
    assert.equal(result.parseError, "Empty response text");
  });
});

describe("stripPathPrefix", () => {
  it("strips the prefix from file references", () => {
    assert.equal(
      stripPathPrefix("Issue in /tmp/agy-review-ab12/src/index.js line 4", "/tmp/agy-review-ab12"),
      "Issue in src/index.js line 4"
    );
  });

  it("replaces bare prefix mentions with a dot", () => {
    assert.equal(stripPathPrefix("Reviewed /tmp/agy-review-ab12 fully", "/tmp/agy-review-ab12"), "Reviewed . fully");
  });

  it("handles the macOS /private symlink variant", () => {
    assert.equal(
      stripPathPrefix("See /private/var/folders/x/agy-review-1/src/a.js", "/var/folders/x/agy-review-1"),
      "See src/a.js"
    );
  });

  it("returns text unchanged without a prefix", () => {
    assert.equal(stripPathPrefix("hello", null), "hello");
  });
});

describe("detectWorkingTreeDelta", () => {
  it("returns lines added after the run", () => {
    const before = " M src/a.js\n";
    const after = " M src/a.js\n?? evil.txt\n";
    assert.deepEqual(detectWorkingTreeDelta(before, after), ["?? evil.txt"]);
  });

  it("returns empty for identical snapshots", () => {
    assert.deepEqual(detectWorkingTreeDelta(" M a\n", " M a\n"), []);
  });

  it("returns empty when either snapshot is unavailable", () => {
    assert.deepEqual(detectWorkingTreeDelta(null, "?? x\n"), []);
    assert.deepEqual(detectWorkingTreeDelta("?? x\n", null), []);
  });
});
```

- [ ] **Step 7: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: PASS. Watch for:
- `review --wait` exercising the real worktree path (the fake repo from `initGitRepo` has a HEAD commit, so worktree creation succeeds).
- `render.test.mjs` — only the setup block was updated; the other describe blocks still pass because their strings change in Task 6.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: swap ACP transport for agy print mode with worktree-isolated reviews"
```

---

### Task 6: User-facing strings — render, job-control, companion, stop-gate hook

Pure wording: every "Gemini" header, `/gemini:*` hint, and `gemini --resume` becomes the Antigravity/agy equivalent. Exact old → new pairs below; each is unique in its file.

**Files:**
- Modify: `plugins/antigravity/scripts/lib/render.mjs`
- Modify: `plugins/antigravity/scripts/lib/job-control.mjs`
- Modify: `plugins/antigravity/scripts/antigravity-companion.mjs`
- Modify: `plugins/antigravity/scripts/stop-review-gate-hook.mjs`
- Test: `tests/render.test.mjs` (remaining assertions)

- [ ] **Step 1: Update render.mjs**

In `plugins/antigravity/scripts/lib/render.mjs` apply these replacements:

| Old | New |
|---|---|
| `function formatGeminiResumeCommand(job) {` | `function formatAgyResumeCommand(job) {` |
| `` return `gemini --resume ${job.sessionId}`; `` | `` return `agy --conversation ${job.sessionId}`; `` |
| `` const actions = [`/gemini:status ${job.id}`]; `` | `` const actions = [`/antigravity:status ${job.id}`]; `` |
| `` actions.push(`/gemini:cancel ${job.id}`); `` | `` actions.push(`/antigravity:cancel ${job.id}`); `` |
| `` lines.push(`  Gemini session ID: ${job.sessionId}`); `` | `` lines.push(`  agy conversation ID: ${job.sessionId}`); `` |
| `const resumeCommand = formatGeminiResumeCommand(job);` | `const resumeCommand = formatAgyResumeCommand(job);` |
| `` lines.push(`  Resume in Gemini: ${resumeCommand}`); `` | `` lines.push(`  Resume with agy: ${resumeCommand}`); `` |
| `` lines.push(`  Cancel: /gemini:cancel ${job.id}`); `` | `` lines.push(`  Cancel: /antigravity:cancel ${job.id}`); `` |
| `` lines.push(`  Result: /gemini:result ${job.id}`); `` | `` lines.push(`  Result: /antigravity:result ${job.id}`); `` |
| `lines.push("  Review changes: /gemini:review --wait");` | `lines.push("  Review changes: /antigravity:review --wait");` |
| `lines.push("  Stricter review: /gemini:adversarial-review --wait");` | `lines.push("  Stricter review: /antigravity:adversarial-review --wait");` |
| `` `# Gemini ${meta.reviewLabel}`, `` (3 occurrences — use replace-all) | `` `# Antigravity ${meta.reviewLabel}`, `` |
| `"Gemini did not return valid structured JSON.",` | `"Antigravity did not return valid structured JSON.",` |
| `"Gemini returned JSON with an unexpected review shape.",` | `"Antigravity returned JSON with an unexpected review shape.",` |
| `|| "Gemini did not return a final message.";` | `|| "Antigravity did not return a final message.";` |
| `"# Gemini Status",` | `"# Antigravity Status",` |
| `lines.push("Ending the session will trigger a fresh Gemini adversarial review and block if it finds issues.");` | `lines.push("Ending the session will trigger a fresh Antigravity adversarial review and block if it finds issues.");` |
| `const lines = ["# Gemini Job Status", ""];` | `const lines = ["# Antigravity Job Status", ""];` |
| `` const resumeCommand = sessionId ? `gemini --resume ${sessionId}` : null; `` | `` const resumeCommand = sessionId ? `agy --conversation ${sessionId}` : null; `` |
| `` return `${output}\nGemini session ID: ${sessionId}\nResume in Gemini: ${resumeCommand}\n`; `` (3 occurrences — replace-all) | `` return `${output}\nagy conversation ID: ${sessionId}\nResume with agy: ${resumeCommand}\n`; `` |
| `` `# ${job.title ?? "Gemini Result"}`, `` | `` `# ${job.title ?? "Antigravity Result"}`, `` |
| `` lines.push(`Gemini session ID: ${sessionId}`); `` | `` lines.push(`agy conversation ID: ${sessionId}`); `` |
| `` lines.push(`Resume in Gemini: ${resumeCommand}`); `` | `` lines.push(`Resume with agy: ${resumeCommand}`); `` |
| `"# Gemini Cancel",` | `"# Antigravity Cancel",` |
| ``lines.push("- Check `/gemini:status` for the updated queue.");`` | ``lines.push("- Check `/antigravity:status` for the updated queue.");`` |

- [ ] **Step 2: Update job-control.mjs**

| Old | New |
|---|---|
| `` throw new Error(`No job found for "${reference}". Run /gemini:status to list known jobs.`); `` | `` throw new Error(`No job found for "${reference}". Run /antigravity:status to list known jobs.`); `` |
| `` throw new Error(`No job found for "${reference}". Run /gemini:status to inspect known jobs.`); `` | `` throw new Error(`No job found for "${reference}". Run /antigravity:status to inspect known jobs.`); `` |
| `` throw new Error(`Job ${active.id} is still ${active.status}. Check /gemini:status and try again once it finishes.`); `` | `` throw new Error(`Job ${active.id} is still ${active.status}. Check /antigravity:status and try again once it finishes.`); `` |
| `` throw new Error(`No finished job found for "${reference}". Run /gemini:status to inspect active jobs.`); `` | `` throw new Error(`No finished job found for "${reference}". Run /antigravity:status to inspect active jobs.`); `` |
| `throw new Error("No finished Gemini jobs found for this repository yet.");` | `throw new Error("No finished Antigravity jobs found for this repository yet.");` |
| `throw new Error("Multiple Gemini jobs are active. Pass a job id to /gemini:cancel.");` | `throw new Error("Multiple Antigravity jobs are active. Pass a job id to /antigravity:cancel.");` |
| `throw new Error("No active Gemini jobs to cancel.");` | `throw new Error("No active Antigravity jobs to cancel.");` |
| `if (line.startsWith("starting gemini") \|\| line.startsWith("session ready") \|\| line.startsWith("turn started")) {` | `if (line.startsWith("starting agy") \|\| line.startsWith("resuming agy") \|\| line.startsWith("session ready")) {` |
| `if (line.startsWith("gemini error:") \|\| line.startsWith("failed:")) {` | `if (line.startsWith("agy error:") \|\| line.startsWith("failed:")) {` |

(The facade's log lines `Starting agy (<model>)` / `Resuming agy conversation <id>` lowercase to `starting agy` / `resuming agy`, so the phase inference keeps working.)

- [ ] **Step 3: Update companion messages**

In `plugins/antigravity/scripts/antigravity-companion.mjs`:

| Old | New |
|---|---|
| `` process.stdout.write(`Started background ${kind}: job ${jobId}\nCheck progress: /gemini:status ${jobId}\nGet result: /gemini:result ${jobId}\n`); `` (in `executeReviewBackground`) | `` process.stdout.write(`Started background ${kind}: job ${jobId}\nCheck progress: /antigravity:status ${jobId}\nGet result: /antigravity:result ${jobId}\n`); `` |
| `` process.stdout.write(`Started background task: job ${jobId}\nCheck progress: /gemini:status ${jobId}\nGet result: /gemini:result ${jobId}\n`); `` (in `executeTask`) | `` process.stdout.write(`Started background task: job ${jobId}\nCheck progress: /antigravity:status ${jobId}\nGet result: /antigravity:result ${jobId}\n`); `` |
| `process.stderr.write("No previous Gemini session found. Starting fresh.\n");` | `process.stderr.write("No previous agy conversation found. Starting fresh.\n");` |
| `` process.stderr.write(`Unknown command: ${command ?? "(none)"}\nUsage: gemini-companion <setup\|review\|adversarial-review\|task\|status\|result\|cancel> [options]\n`); `` | `` process.stderr.write(`Unknown command: ${command ?? "(none)"}\nUsage: antigravity-companion <setup\|review\|adversarial-review\|task\|status\|result\|cancel> [options]\n`); `` |

- [ ] **Step 4: Update stop-review-gate-hook.mjs prose**

| Old | New |
|---|---|
| `` return `Gemini is not set up for the review gate. ${authStatus.detail}. Run /gemini:setup and, if needed, !gemini auth login.`; `` | `` return `Antigravity is not set up for the review gate. ${authStatus.detail}. Run /antigravity:setup and, if needed, run agy interactively to sign in.`; `` |
| `"The stop-time Gemini review task returned no final output. Run /gemini:review --wait manually or bypass the gate."` | `"The stop-time Antigravity review task returned no final output. Run /antigravity:review --wait manually or bypass the gate."` |
| `` reason: `Gemini stop-time review found issues that still need fixes before ending the session: ${reason}` `` | `` reason: `Antigravity stop-time review found issues that still need fixes before ending the session: ${reason}` `` |
| `"The stop-time Gemini review task returned an unexpected answer. Run /gemini:review --wait manually or bypass the gate."` | `"The stop-time Antigravity review task returned an unexpected answer. Run /antigravity:review --wait manually or bypass the gate."` |
| `"The stop-time Gemini review task timed out after 15 minutes. Run /gemini:review --wait manually or bypass the gate."` | `"The stop-time Antigravity review task timed out after 15 minutes. Run /antigravity:review --wait manually or bypass the gate."` |
| `` ? `The stop-time Gemini review task failed: ${detail}` `` | `` ? `The stop-time Antigravity review task failed: ${detail}` `` |
| `: "The stop-time Gemini review task failed. Run /gemini:review --wait manually or bypass the gate."` | `: "The stop-time Antigravity review task failed. Run /antigravity:review --wait manually or bypass the gate."` |
| `"The stop-time Gemini review task returned invalid JSON. Run /gemini:review --wait manually or bypass the gate."` | `"The stop-time Antigravity review task returned invalid JSON. Run /antigravity:review --wait manually or bypass the gate."` |
| `` ? `Gemini task ${runningJob.id} is still running. Check /gemini:status and use /gemini:cancel ${runningJob.id} if you want to stop it before ending the session.` `` | `` ? `Antigravity task ${runningJob.id} is still running. Check /antigravity:status and use /antigravity:cancel ${runningJob.id} if you want to stop it before ending the session.` `` |

- [ ] **Step 5: Update remaining render.test.mjs assertions**

In `tests/render.test.mjs`, update every assertion expecting the old strings. The changed expectations are exactly:

- `assert.ok(output.includes("# Gemini Review"))` → `assert.ok(output.includes("# Antigravity Review"))` (and the same for any `Adversarial Review` title assertions)
- assertions containing `"Gemini did not return valid structured JSON"` → `"Antigravity did not return valid structured JSON"`
- assertions containing `"Gemini did not return a final message"` → `"Antigravity did not return a final message"`
- assertions containing `"# Gemini Cancel"` → `"# Antigravity Cancel"`
- assertions containing `/gemini:status` → `/antigravity:status`

Open the file, search for `Gemini` and `gemini`, and update each assertion to the new literal from Steps 1-4. Do not change test structure.

- [ ] **Step 6: Verify no stray references in runtime sources**

```bash
grep -rn "Gemini\|gemini" plugins/antigravity/scripts/ | grep -v "antigravity" | grep -viE "\.gemini|Gemini 3\.|oauth_creds|google_accounts"
```

Expected: no output (the allowed remnants are the `~/.gemini` auth dir and `Gemini 3.x` model labels).

- [ ] **Step 7: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rebrand user-facing strings to Antigravity/agy"
```

---

### Task 7: Commands, agent, skills, hooks.json content

Full rewrites of the markdown definition files. These are not covered by the automated suite (except arg parsing), so the verification step is a grep + manual read.

**Files:**
- Modify: all 7 `plugins/antigravity/commands/*.md`
- Modify: `plugins/antigravity/agents/antigravity-rescue.md`
- Modify: all 3 `plugins/antigravity/skills/*/SKILL.md`
- Rename+modify: `plugins/antigravity/skills/antigravity-prompting/references/gemini-prompt-recipes.md` → `prompt-recipes.md`
- Modify: `plugins/antigravity/hooks/hooks.json` (description only)
- Verify: `plugins/antigravity/prompts/*.md` (no changes expected — templates are vendor-neutral)

- [ ] **Step 1: review.md**

`plugins/antigravity/commands/review.md` — full new content:

```markdown
---
description: Run an Antigravity code review on your current work
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--wait] [--background]'
allowed-tools: Bash(node:*), AskUserQuestion
---

This command runs a code review through the Antigravity CLI (agy).

Parse the user's arguments. Supported flags: `--base <ref>`, `--scope <auto|working-tree|branch>`, `--model <model>`, `--wait`, `--background`.

## Execution modes

**Foreground (`--wait`):**
Run immediately without confirmation:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" review --wait $ARGUMENTS
```

Return the stdout verbatim. Do not paraphrase, summarize, or add commentary.

**Background (`--background`):**
Run without waiting:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" review --background $ARGUMENTS
```

Tell the user the job was started and to check `/antigravity:status` for progress.

**Default (no flag):**
Estimate the review scope by running:

```bash
git status --short --untracked-files=all
git diff --shortstat
```

If the output shows only 1-2 small files with minor changes, recommend foreground.
In every other case, including unclear size, recommend background.

Use `AskUserQuestion` to let the user pick foreground or background.

## Constraints

- This is review-only. The review runs in a disposable git worktree, so it cannot modify your working tree. Do not fix issues, apply patches, or suggest that you are about to make changes.
- This does not support staged-only review, unstaged-only review, or extra focus text. Use `/antigravity:adversarial-review` when you want custom instructions.
- Present the Antigravity output exactly as returned.
```

- [ ] **Step 2: adversarial-review.md**

`plugins/antigravity/commands/adversarial-review.md` — full new content:

```markdown
---
description: Run a steerable adversarial Antigravity review that challenges your implementation choices
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--wait] [--background] [focus text...]'
allowed-tools: Bash(node:*), AskUserQuestion
---

This command runs a challenge review through Antigravity (agy) that questions the chosen implementation, design choices, tradeoffs, and assumptions.

Parse the user's arguments. Supported flags: `--base <ref>`, `--scope <auto|working-tree|branch>`, `--model <model>`, `--wait`, `--background`. Everything after the flags is focus text.

## Execution modes

**Foreground (`--wait`):**
Run immediately:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" adversarial-review --wait $ARGUMENTS
```

Return stdout verbatim. Do not paraphrase.

**Background (`--background`):**
Run without waiting:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" adversarial-review --background $ARGUMENTS
```

Tell the user the job was started and to check `/antigravity:status`.

**Default:**
Estimate scope by checking git status and diff stats.
If small (1-2 files), run foreground. Otherwise recommend background.
Use `AskUserQuestion` to let the user choose.

## Constraints

- This is review-only. The review runs in a disposable git worktree, so it cannot modify your working tree. Do not fix issues, apply patches, or suggest that you are about to make changes.
- Present the Antigravity output exactly as returned.
```

- [ ] **Step 3: rescue.md**

`plugins/antigravity/commands/rescue.md` — full new content:

```markdown
---
description: Hand a task to Antigravity through the antigravity:antigravity-rescue subagent
argument-hint: '[--background] [--wait] [--model <model>] [--resume] [--fresh] [task description...]'
allowed-tools: Bash(node:*), Agent(antigravity:antigravity-rescue), AskUserQuestion
---

This command delegates work to Antigravity (agy) through the `antigravity:antigravity-rescue` subagent.

Parse the user's arguments. Supported flags: `--background`, `--wait`, `--model <model>`, `--resume`, `--fresh`. Everything after the flags is the task description.

## Resume logic

Before launching the subagent, check whether a resumable agy conversation exists:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" status --json
```

If there is a recent task conversation and the user did not pass `--resume` or `--fresh`:
- Use `AskUserQuestion` to ask whether to continue the existing conversation or start fresh.
- If the user's text contains follow-up phrases like "continue", "keep going", "dig deeper", or "pick up where you left off", recommend resuming.

## Execution

Route the request to the `antigravity:antigravity-rescue` subagent. The subagent is a thin forwarder that invokes:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" task <arguments>
```

Pass all flags and the task description through.

## Constraints

- You are a thin forwarder only. Do not inspect the repository, read files, or do independent work.
- Return the Antigravity output exactly as returned by the subagent. Do not paraphrase or add commentary.
```

- [ ] **Step 4: setup.md**

`plugins/antigravity/commands/setup.md` — full new content (the npm auto-install flow is gone — agy is not npm-installable):

```markdown
---
description: Check whether the local Antigravity CLI (agy) is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" setup --json $ARGUMENTS
```

Output rules:
- Present the final setup output to the user.
- If agy is missing, tell the user to install Antigravity (https://antigravity.google), which bundles the `agy` CLI, then rerun `/antigravity:setup`.
- If agy is installed but not authenticated, tell the user to run `agy` interactively once, complete the Google sign-in, then rerun `/antigravity:setup`.
- Do not attempt to install or authenticate on the user's behalf.
```

- [ ] **Step 5: status.md, result.md, cancel.md**

`plugins/antigravity/commands/status.md` — full new content:

```markdown
---
description: Show active and recent Antigravity jobs for this repository
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" status $ARGUMENTS`

If the user did not pass a job ID:
- Render the command output as a single Markdown table for the current and past runs in this session.
- Keep it compact. Do not include progress blocks or extra prose outside the table.
- Preserve the actionable fields from the command output, including job ID, kind, status, phase, elapsed or duration, summary, and follow-up commands.

If the user did pass a job ID:
- Present the full command output to the user.
- Do not summarize or condense it.
```

`plugins/antigravity/commands/result.md` — full new content:

```markdown
---
description: Show the final stored Antigravity output for a finished job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" result $ARGUMENTS`

Present the complete, unmodified command output to the user, including:
- Job identification
- Status information
- The full result payload without condensation
- Any file references with exact line numbers
- Any errors encountered
- Suggested follow-up commands like `/antigravity:status` and `/antigravity:review`
- agy conversation ID for resuming in the Antigravity CLI with `agy --conversation <conversation-id>`

Do not summarize or condense the findings.
```

`plugins/antigravity/commands/cancel.md` — full new content:

```markdown
---
description: Cancel an active background Antigravity job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" cancel $ARGUMENTS`
```

- [ ] **Step 6: antigravity-rescue agent**

`plugins/antigravity/agents/antigravity-rescue.md` — full new content:

```markdown
---
description: Proactively use when Claude Code is stuck, wants a second implementation or diagnosis pass, needs a deeper root-cause investigation, or should hand a substantial coding task to Antigravity through the shared runtime
allowed-tools: Bash(node:*)
---

You are the `antigravity-rescue` forwarding wrapper. Your only job is to forward the user's rescue request to the Antigravity companion script.

## When to trigger

Proactively offer this subagent when:
- The main Claude thread is stuck in a loop or has failed the same approach multiple times.
- The user explicitly asks to delegate something to Antigravity (or "agy", or legacy "Gemini" phrasing).
- A task would benefit from a second implementation pass with a different model.

Do NOT grab simple asks that the main Claude thread can finish quickly.

## How to forward

Invoke a single Bash call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" task <arguments>
```

### Argument shaping rules

1. Default to **foreground** execution for small, bounded requests.
2. Add `--background` for complex, multi-step, or long-running tasks.
3. Add `--write` by default so Antigravity can make edits. Omit it only when the user explicitly asks for read-only behavior.
4. If the user says `--resume` or follow-up phrases ("continue", "keep going", "pick up where you left off"), use `--resume-last`.
5. If the user says `--fresh`, start a new conversation without resuming.
6. Strip routing controls (`--effort`, `--model`) from the task text and pass them as flags instead.
7. Model aliases: `pro` maps to `Gemini 3.1 Pro (High)` (default), `flash` to `Gemini 3.5 Flash (High)`, `sonnet`/`opus` to the Claude 4.6 thinking models, `gpt-oss` to `GPT-OSS 120B (Medium)`.

### Output rules

- Return whatever the `task` command prints to stdout exactly as-is.
- Do NOT paraphrase, summarize, or add commentary.
- Do NOT perform any follow-up inspection, progress monitoring, or status polling.
- Do NOT read repository files or do any independent analysis.
```

- [ ] **Step 7: Skills**

`plugins/antigravity/skills/antigravity-cli-runtime/SKILL.md` — full new content:

```markdown
---
description: Internal helper contract for invoking the antigravity-companion runtime from Claude Code. Used exclusively within the antigravity:antigravity-rescue subagent.
---

# Antigravity CLI Runtime

This skill describes the internal contract for invoking the Antigravity companion runtime.

## Primary helper

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/antigravity-companion.mjs" task "<raw arguments>"
```

## Rules

- The rescue subagent is a forwarder, not an orchestrator.
- Its sole job is to invoke `task` once and return that stdout unchanged.
- Use `task` for all rescue requests: diagnosis, planning, research, and fixes.
- Do NOT call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel` from within rescue.
- Strip `--background` and `--wait` from the task text and pass them as flags.
- Leave `--model` unset unless the user explicitly requests a specific model.
- Model aliases: `pro` → `Gemini 3.1 Pro (High)` (default), `pro-low` → `Gemini 3.1 Pro (Low)`, `flash` → `Gemini 3.5 Flash (High)`, `flash-medium` / `flash-low` → the lower Flash tiers, `sonnet` / `opus` → Claude 4.6 (Thinking), `gpt-oss` → `GPT-OSS 120B (Medium)`.
- Default to write-capable runs by adding `--write` unless the user asks for read-only.
- `--resume` triggers `task --resume-last`.
- `--fresh` starts a clean `task` run.

## Safety

- Do NOT inspect the repository, read files, or perform independent analysis.
- Do NOT do follow-up work or progress monitoring.
- Return the `task` command's stdout exactly as provided. No modifications, no summaries.
```

`plugins/antigravity/skills/antigravity-prompting/SKILL.md` — full new content:

```markdown
---
description: Internal guidance for composing effective prompts for Antigravity models when constructing task, review, and research prompts within the plugin.
---

# Antigravity Prompt Composition

Use structured blocks to compose prompts for Antigravity models. Follow these principles:

1. **State the task clearly** in a `<task>` block.
2. **Define the output contract** explicitly so the model knows the expected format.
3. **Add verification rules** for risky tasks.
4. **Use consistent tagging** across all prompts.

## Block types

See `references/prompt-blocks.md` for the full block catalog.
See `references/prompt-recipes.md` for task-specific templates.

## Key principles

- One job per prompt. Don't mix review, fix, docs, and roadmap.
- Ground every claim in provided context or tool outputs.
- If a point is an inference, label it clearly.
- Default to continuation: keep going until the task is complete.
- Verify before finalizing: check that the answer matches evidence and requirements.
```

Rename the recipes reference and update its title line:

```bash
git mv plugins/antigravity/skills/antigravity-prompting/references/gemini-prompt-recipes.md \
       plugins/antigravity/skills/antigravity-prompting/references/prompt-recipes.md
```

Then open `prompt-recipes.md` and `prompt-blocks.md` and replace any "Gemini" prose with "Antigravity" (model-name mentions like "Gemini 3.1 Pro" stay).

`plugins/antigravity/skills/antigravity-result-handling/SKILL.md` — full new content:

```markdown
---
description: Internal guidance for presenting Antigravity helper output to the user. Covers review results, task output, and error handling.
---

# Antigravity Result Handling

## Preservation rules

- Preserve the helper's verdict, summary, findings, and next steps structure.
- Keep review findings ordered by severity.
- Keep file paths and line numbers exact.
- Distinguish confirmed facts, inferences, and uncertainties as marked.

## Review safeguard

After presenting review findings, **STOP**. Do not make any code changes.
The user must explicitly approve which issues to address before any modifications.

## Error handling

- Report failed or incomplete Antigravity runs without attempting Claude-side workarounds.
- Include actionable stderr output when setup or authentication issues arise.
- Direct users to `/antigravity:setup` for authentication rather than improvising alternatives.

## Output rules

- Present requested sections: observed facts, open questions, touched files.
- State explicitly when no findings exist.
- List modified files when Antigravity makes edits.
- When an agy conversation ID is available, include it so the user can resume with `agy --conversation <conversation-id>`.

## Overriding principle

Communicate Antigravity's output faithfully, avoid auto-fixing, and obtain user consent before any code modifications.
```

- [ ] **Step 8: hooks.json description**

In `plugins/antigravity/hooks/hooks.json`:

```json
// old
  "description": "Optional stop-time review gate for Gemini Companion.",
// new
  "description": "Optional stop-time review gate for Antigravity Companion.",
```

- [ ] **Step 9: Verify prompts are vendor-neutral**

```bash
grep -in "gemini" plugins/antigravity/prompts/*.md plugins/antigravity/schemas/*.json
```

Expected: no output. (The templates address "you" and never name the vendor.)

- [ ] **Step 10: Run the suite and commit**

Run: `node --test tests/*.test.mjs`
Expected: PASS (these files aren't exercised by tests; this is a regression guard).

```bash
git add -A
git commit -m "docs: rebrand commands, agent, skills, and hooks to Antigravity"
```

---

### Task 8: Repository docs — README, AGENTS.md, CLAUDE.md, CHANGELOG, NOTICE, package.json

**Files:**
- Rewrite: `README.md` (directive + section texts below)
- Rewrite: `AGENTS.md` (full content below; absorbs `GEMINI.md`)
- Delete: `GEMINI.md`
- Rewrite: `CLAUDE.md` (full content below)
- Modify: `plugins/antigravity/CHANGELOG.md` (prepend 2.0.0 entry)
- Modify: `NOTICE`, `plugins/antigravity/NOTICE` (title line)
- Modify: `package.json` (name/description)

- [ ] **Step 1: package.json**

```json
// old
  "name": "@anthropic/gemini-plugin-cc",
  "version": "1.0.0",
  ...
  "description": "Use Gemini from Claude Code to review code or delegate tasks.",
// new
  "name": "@anthropic/antigravity-plugin-cc",
  "version": "2.0.0",
  ...
  "description": "Use Antigravity (agy) from Claude Code to review code or delegate tasks.",
```

(Other fields unchanged.)

- [ ] **Step 2: NOTICE files**

In both `NOTICE` and `plugins/antigravity/NOTICE`, change the first line:

```
// old
Gemini Plugin for Claude Code
// new
Antigravity Plugin for Claude Code
```

(The rest — Apache 2.0 / codex-plugin-cc attribution — stays.)

- [ ] **Step 3: CHANGELOG**

Prepend to `plugins/antigravity/CHANGELOG.md` (keep the existing 1.0.0 entry below it):

```markdown
## 2.0.0

Adaptation from the deprecated Gemini CLI to Antigravity (`agy`). Breaking: the
plugin is now named `antigravity` and all commands moved from `/gemini:*` to
`/antigravity:*`.

- Execution backend replaced: ACP (JSON-RPC over stdio) → `agy --print`
  subprocess with prompt on stdin
- Reviews run inside disposable git worktrees (agy has no read-only mode);
  stray writes can never touch your working tree
- Conversation IDs captured from agy's log; resume via `--resume-last` or
  `agy --conversation <id>`
- Models are agy display labels; default `Gemini 3.1 Pro (High)`; aliases:
  `pro`, `pro-low`, `flash`, `flash-medium`, `flash-low`, `sonnet`, `opus`,
  `gpt-oss`
- Silent model fallback (unrecognized `--model` values) is detected and
  reported as a failure instead of reviewing with the wrong model
- Read-only tasks get a prompt guard plus before/after `git status` drift
  detection with a prominent warning
- Auth via the shared `~/.gemini` Google account state; sign in by running
  `agy` interactively once
```

- [ ] **Step 4: AGENTS.md**

`AGENTS.md` — full new content (absorbs the old GEMINI.md duties):

```markdown
# Antigravity Plugin for Claude Code — Agent Instructions

## Project Overview

This is a Claude Code plugin that wraps Google's Antigravity CLI (`agy`) for code reviews and task delegation. It provides `/antigravity:*` slash commands that invoke the `agy` binary as a subprocess.

Based on the architecture of [codex-plugin-cc](https://github.com/openai/codex-plugin-cc) by OpenAI, originally adapted for Gemini CLI (ACP) and now ported to Antigravity print mode.

## Architecture

- **Print mode**: Spawns `agy --print` per task/review with the prompt written to stdin. No persistent server, broker, or JSON-RPC layer.
- **Conversation tracking**: agy's per-job glog (`--log-file`) is parsed for `Print mode: conversation=<uuid>` and the propagated model label. Conversation IDs are stored in job state (the `sessionId` field) and resumed with `agy --conversation <id>`.
- **Model fallback detection**: `--model` only accepts agy display labels (e.g. `Gemini 3.1 Pro (High)`); anything else silently falls back to Flash Medium. The facade compares the requested label with the propagated label from the log and fails loudly on mismatch.
- **Review isolation**: agy has no read-only mode and auto-approves file writes in print mode. Reviews therefore run inside a disposable detached git worktree (`lib/review-worktree.mjs`) that mirrors the working state; stray writes land in the throwaway worktree. Orphaned worktrees older than 24h are swept at review start.
- **Structured output**: Reviews request JSON via prompt engineering. No native schema enforcement.
- **Background jobs**: Detached Node.js worker processes with SIGTERM-based graceful cancellation (worker SIGTERM → SIGTERM to the agy child → agy cancels its conversation) and partial output preservation.
- **Timeouts**: agy's own `--print-timeout` is the primary bound; a Node watchdog at timeout+30s catches hung processes.

## Tech Stack

- **Runtime**: Node.js 18.18+ ESM (`.mjs` files throughout)
- **Package manager**: bun (no npm/yarn/pnpm)
- **Tests**: `node --test tests/*.test.mjs` (Node.js built-in test runner)
- **No build step**: All source is plain JavaScript, no TypeScript compilation
- **No external dependencies**: Zero npm packages — stdlib only

## Key Files

| File | Role |
|---|---|
| `plugins/antigravity/scripts/lib/antigravity.mjs` | Core facade — task/review execution, auth detection, shutdown handling, output post-processing |
| `plugins/antigravity/scripts/lib/agy-cli.mjs` | agy print-mode subprocess layer — arg building, log parsing, watchdog |
| `plugins/antigravity/scripts/lib/review-worktree.mjs` | Disposable git worktree lifecycle for review isolation |
| `plugins/antigravity/scripts/lib/models.mjs` | Model display labels, aliases, default model |
| `plugins/antigravity/scripts/antigravity-companion.mjs` | Main CLI orchestrator — dispatches setup, review, task, status, result, cancel |
| `plugins/antigravity/scripts/lib/render.mjs` | Markdown output formatting for all commands |
| `plugins/antigravity/scripts/lib/state.mjs` | Persistent state management (jobs, config) |
| `plugins/antigravity/scripts/lib/git.mjs` | Git operations for review context collection |
| `plugins/antigravity/scripts/lib/job-control.mjs` | Job enrichment, status snapshots, result resolution |
| `plugins/antigravity/scripts/lib/tracked-jobs.mjs` | Job lifecycle tracking with progress reporting |
| `plugins/antigravity/hooks/hooks.json` | SessionStart/End/Stop hook definitions |
| `plugins/antigravity/prompts/review.md` | Standard code review prompt template |
| `plugins/antigravity/prompts/adversarial-review.md` | Adversarial review prompt template |

## Plugin Structure

```
plugins/antigravity/
├── .claude-plugin/plugin.json    # Plugin manifest
├── agents/                       # Subagent definitions
├── commands/                     # Slash command definitions (.md with frontmatter)
├── hooks/hooks.json              # Hook definitions
├── prompts/                      # Prompt templates for reviews
├── schemas/                      # JSON schemas for structured output
├── scripts/                      # Node.js runtime code
│   ├── antigravity-companion.mjs # Main entry point
│   ├── session-lifecycle-hook.mjs
│   ├── stop-review-gate-hook.mjs
│   └── lib/                      # Shared modules
└── skills/                       # Skill definitions with references
```

## Model Aliases

Model IDs are agy display labels (the only form `agy --model` resolves):

- `pro` → `Gemini 3.1 Pro (High)` (default)
- `pro-low` → `Gemini 3.1 Pro (Low)`
- `flash` → `Gemini 3.5 Flash (High)`
- `flash-medium` → `Gemini 3.5 Flash (Medium)`
- `flash-low` → `Gemini 3.5 Flash (Low)`
- `sonnet` → `Claude Sonnet 4.6 (Thinking)`
- `opus` → `Claude Opus 4.6 (Thinking)`
- `gpt-oss` → `GPT-OSS 120B (Medium)`

Defined in `plugins/antigravity/scripts/lib/models.mjs`. Unknown values pass through verbatim (agy supports custom models in its settings); silent fallback is detected post-run.

## How Reviews Work

1. Collect git diff context (`lib/git.mjs`) — embedded directly in the prompt
2. Build a review prompt from templates in `plugins/antigravity/prompts/`
3. Embed the JSON schema from `plugins/antigravity/schemas/review-output.schema.json`
4. Create a disposable git worktree mirroring the working state (`lib/review-worktree.mjs`)
5. Run `agy --print` with cwd = worktree (read access to repo files, writes isolated)
6. Parse the structured JSON from stdout; strip worktree paths from output
7. Remove the worktree

## Development Conventions

- All source files use `.mjs` extension (ESM)
- No TypeScript — plain JavaScript with JSDoc where helpful
- State stored in `$CLAUDE_PLUGIN_DATA` or `$TMPDIR/antigravity-companion/`
- Environment variable prefix: `ANTIGRAVITY_COMPANION_*`
- Tests use a fake `agy` binary fixture (`tests/fake-agy-fixture.mjs`) — no real API calls

## Running Tests

```bash
node --test tests/*.test.mjs
```

## Common Tasks

- **Add a new command**: Create `plugins/antigravity/commands/<name>.md` with frontmatter, add handler in `antigravity-companion.mjs`
- **Change review prompts**: Edit `plugins/antigravity/prompts/review.md` or `adversarial-review.md`
- **Update model defaults**: Edit `DEFAULT_MODEL` and `MODEL_ALIASES` in `plugins/antigravity/scripts/lib/models.mjs`
- **Add a new skill**: Create `plugins/antigravity/skills/<name>/SKILL.md` with frontmatter
```

Then delete the old Gemini CLI context file:

```bash
git rm GEMINI.md
```

- [ ] **Step 5: CLAUDE.md**

`CLAUDE.md` — full new content:

```markdown
# Antigravity Plugin for Claude Code

## Project Structure

This is a Claude Code plugin that wraps Google's Antigravity CLI (`agy`) for code reviews and task delegation.
It mirrors the architecture of [codex-plugin-cc](https://github.com/openai/codex-plugin-cc); the original
Gemini CLI (ACP) backend was replaced with agy print-mode subprocess execution.

## Key Architecture

- **Print mode**: Spawns `agy --print` per run, prompt via stdin — no persistent server or JSON-RPC layer
- **Conversations**: agy conversation IDs parsed from its `--log-file` glog, stored in job state, resumed with `--conversation`
- **Review isolation**: reviews run in disposable git worktrees (agy has no read-only mode)
- **Model fallback detection**: agy silently falls back on unknown `--model` values; the plugin detects this from the log and fails loudly
- **Structured output**: prompt-based JSON (no native schema enforcement)
- **Default model**: `Gemini 3.1 Pro (High)` (alias `pro`; configurable via `--model`)

## Development

- Runtime: Node.js ESM (`.mjs` files)
- Tests: `node --test tests/*.test.mjs`
- No build step required

## File Layout

- `plugins/antigravity/` — the plugin root
- `plugins/antigravity/.claude-plugin/plugin.json` — plugin manifest
- `plugins/antigravity/scripts/antigravity-companion.mjs` — main CLI orchestrator
- `plugins/antigravity/scripts/lib/antigravity.mjs` — task/review execution facade, shutdown handling
- `plugins/antigravity/scripts/lib/agy-cli.mjs` — agy print-mode subprocess layer (args, log parsing, watchdog)
- `plugins/antigravity/scripts/lib/review-worktree.mjs` — disposable worktree lifecycle for reviews
- `plugins/antigravity/scripts/lib/models.mjs` — model display labels, aliases, DEFAULT_MODEL
- `plugins/antigravity/scripts/lib/` — shared utilities (args, fs, git, process, state, etc.)
- `plugins/antigravity/commands/` — slash command definitions (.md)
- `plugins/antigravity/agents/` — subagent definitions (.md)
- `plugins/antigravity/skills/` — skill definitions
- `plugins/antigravity/prompts/` — prompt templates
- `plugins/antigravity/hooks/` — hook definitions
```

- [ ] **Step 6: README.md**

Rewrite `README.md` with these rules:

1. Global mechanical replacements (everywhere except the exceptions below):
   - `/gemini:` → `/antigravity:`
   - `gemini:gemini-rescue` → `antigravity:antigravity-rescue`
   - `Gemini plugin` → `Antigravity plugin`; standalone `Gemini` → `Antigravity` in prose
   - `btli/gemini-plugin-cc` → `btli/antigravity-plugin-cc`
   - `/plugin install gemini` → `/plugin install antigravity`
   - **Exceptions (keep verbatim):** model labels (`Gemini 3.1 Pro (High)` etc.) and the `~/.gemini` path if mentioned.

2. Replace the **title + intro**:

```markdown
# Antigravity plugin for Claude Code

Use Antigravity (agy) from inside Claude Code for code reviews or to delegate tasks.

This plugin is for Claude Code users who want an easy way to use Google's Antigravity
models from the workflow they already have. It replaces the deprecated
[gemini-plugin-cc](https://github.com/btli/gemini-plugin-cc) Gemini CLI integration.
```

3. Replace the **Requirements** section:

```markdown
## Requirements

- **Antigravity** with a signed-in Google account.
  - The `agy` CLI ships with [Antigravity](https://antigravity.google). Usage counts against your Antigravity limits.
- **Node.js 18.18 or later**
- **git** (reviews run inside disposable git worktrees)
```

4. In the **Install** section, replace the npm-install and auth paragraphs with:

```markdown
`/antigravity:setup` will tell you whether agy is ready.

If `agy` is missing, install [Antigravity](https://antigravity.google) — it bundles the CLI.

If agy is installed but not signed in yet, run it interactively once and complete the Google sign-in:

```bash
agy
```
```

5. Add a **Models** section (after the command usage sections):

```markdown
## Models

The default model is `Gemini 3.1 Pro (High)`. Pass `--model <alias>` to any review or rescue command:

| Alias | Model |
|---|---|
| `pro` (default) | Gemini 3.1 Pro (High) |
| `pro-low` | Gemini 3.1 Pro (Low) |
| `flash` | Gemini 3.5 Flash (High) |
| `flash-medium` | Gemini 3.5 Flash (Medium) |
| `flash-low` | Gemini 3.5 Flash (Low) |
| `sonnet` | Claude Sonnet 4.6 (Thinking) |
| `opus` | Claude Opus 4.6 (Thinking) |
| `gpt-oss` | GPT-OSS 120B (Medium) |

Unknown values are passed to agy verbatim (for custom models defined in your agy settings). If agy does not recognize the model it would silently fall back to Flash Medium — the plugin detects this and fails the run instead.
```

6. Add a **Migrating from /gemini** section at the end:

```markdown
## Migrating from the Gemini plugin

Every `/gemini:*` command has a 1:1 `/antigravity:*` replacement (`/gemini:review` → `/antigravity:review`, etc.).
Old Gemini job state is not migrated; finish or discard in-flight Gemini jobs before switching.
Session resume now uses agy conversations: `agy --conversation <id>` replaces `gemini --resume <id>`.
```

7. Add a **Known limitations** section (from the spec):

```markdown
## Known limitations

- Read-only **tasks** rely on prompt guidance plus post-run `git status` drift detection (with a prominent warning); only reviews get hard worktree isolation.
- Review worktrees do not initialize git submodules; submodule content is absent from the worktree (the embedded diff still covers it).
- No streaming progress: `/antigravity:status` shows the job log, not token-level streaming.
- agy must be signed in via one interactive run before background jobs work.
```

8. Where the old README mentions `gemini --resume <session-id>`, replace with `agy --conversation <conversation-id>`.

- [ ] **Step 7: Verify and commit**

```bash
grep -rn "gemini" README.md CLAUDE.md AGENTS.md package.json NOTICE plugins/antigravity/NOTICE plugins/antigravity/CHANGELOG.md | grep -viE "Gemini 3\.|gemini-plugin-cc|~/.gemini|\.gemini"
```

Expected: no output (allowed remnants: model labels, the old-repo link in the README intro/CHANGELOG, the `~/.gemini` auth path).

Run: `node --test tests/*.test.mjs`
Expected: PASS.

```bash
git add -A
git commit -m "docs: rewrite README/AGENTS/CLAUDE/CHANGELOG for Antigravity, drop GEMINI.md"
```

---

### Task 9: Final sweep, live smoke test, PR

**Files:** none new — verification only.

- [ ] **Step 1: Whole-repo residual grep**

```bash
grep -rin "gemini" --include="*.mjs" --include="*.json" --include="*.md" . \
  | grep -v node_modules | grep -v "^\./\.git/" | grep -v "^\./docs/" \
  | grep -viE "Gemini 3\.|~/.gemini|\.gemini/|gemini-plugin-cc|google_accounts|oauth_creds"
```

Expected: no output. `docs/` (specs/plans/TODO history) is intentionally excluded — leave historical docs unchanged.

- [ ] **Step 2: Full suite, twice (flake check for the worktree/process tests)**

Run: `node --test tests/*.test.mjs && node --test tests/*.test.mjs`
Expected: PASS both times.

- [ ] **Step 3: Live smoke test (requires agy installed + signed in — skip on CI)**

```bash
cd "$(mktemp -d)" && git init -q . && echo "# smoke" > README.md && git add . && git commit -qm init
node /Users/bryanli/Projects/btli/gemini-plugin-cc/plugins/antigravity/scripts/antigravity-companion.mjs setup --json
node /Users/bryanli/Projects/btli/gemini-plugin-cc/plugins/antigravity/scripts/antigravity-companion.mjs task --wait "Reply with exactly: SMOKE_OK"
```

Expected: setup reports `"ready": true`; task prints `SMOKE_OK`. Then verify review + resume:

```bash
echo "console.log('x')" > index.js
node /Users/bryanli/Projects/btli/gemini-plugin-cc/plugins/antigravity/scripts/antigravity-companion.mjs review --wait
node /Users/bryanli/Projects/btli/gemini-plugin-cc/plugins/antigravity/scripts/antigravity-companion.mjs task --wait --resume-last "What did I ask you to reply with earlier?"
```

Expected: review renders a verdict; the resumed task references `SMOKE_OK`. Confirm no `agy-review-*` directories remain in `$TMPDIR` afterwards.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/antigravity-adaptation
gh pr create --title "Adapt plugin from deprecated Gemini CLI to Antigravity (agy)" --body "$(cat <<'EOF'
## Summary
- Replace the ACP (JSON-RPC) Gemini CLI backend with `agy --print` subprocess execution (prompt via stdin, conversation IDs parsed from agy's log)
- Full rebrand: plugin `antigravity`, commands `/antigravity:*`, version 2.0.0
- Reviews run in disposable git worktrees (agy has no read-only mode)
- Silent model-fallback detection; models are agy display labels, default `Gemini 3.1 Pro (High)`

## Spec & plan
- `docs/superpowers/specs/2026-06-06-antigravity-adaptation-design.md`
- `docs/superpowers/plans/2026-06-07-antigravity-adaptation.md`

## Manual follow-up
- Rename the GitHub repo to `antigravity-plugin-cc` (marketplace add command in the README assumes the new name)

## Test plan
- [ ] `node --test tests/*.test.mjs` green
- [ ] Live smoke: setup/task/review/resume against real agy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Execution notes

- **Concurrency**: `git worktree add` is internally locked by git; concurrent background reviews are safe (distinct job-id paths).
- **Do not** "fix" the dual-purpose `sessionId` field (see header note).
- **Windows**: untested territory for the worktree path comparisons (`realTmpDir`); the existing plugin was macOS/Linux-focused — keep that scope.
- If agy's log line formats change in a future version, `parseAgyLog` returns nulls: tasks still succeed (no conversation id → no resume), and model-fallback detection degrades to off. Both are soft failures by design.

