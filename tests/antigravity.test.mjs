import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseStructuredOutput,
  stripPathPrefix,
  detectWorkingTreeDelta,
  runAntigravityTask
} from "../plugins/antigravity/scripts/lib/antigravity.mjs";
import { createTempDir, cleanTempDir, initGitRepo } from "./helpers.mjs";
import { installFakeAgy } from "./fake-agy-fixture.mjs";

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

describe("runAntigravityTask failure branches", () => {
  it("reports model fallback with the resolved label and alias note", async () => {
    const binDir = createTempDir("facade-test-");
    try {
      const agyPath = installFakeAgy(binDir, "model-fallback");
      const result = await runAntigravityTask(binDir, {
        prompt: "x",
        model: "pro",
        binary: agyPath,
        timeoutMs: 10_000
      });
      assert.equal(result.ok, false);
      assert.equal(result.stopReason, "error");
      assert.ok(result.failureMessage.includes('Model "Gemini 3.1 Pro (High)" is unavailable'));
      assert.ok(result.failureMessage.includes('(requested via "pro")'));
      assert.ok(result.failureMessage.includes('fell back to "Gemini 3.5 Flash (Medium)"'));
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("maps rate-limit stderr to a rate-limit failure message", async () => {
    const binDir = createTempDir("facade-test-");
    try {
      const agyPath = installFakeAgy(binDir, "rate-limit");
      const result = await runAntigravityTask(binDir, {
        prompt: "x",
        binary: agyPath,
        timeoutMs: 10_000
      });
      assert.equal(result.ok, false);
      assert.ok(result.failureMessage.includes("hit rate limits"));
      assert.ok(result.failureMessage.includes("Try: --model"));
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("maps auth-error output to a sign-in failure message", async () => {
    const binDir = createTempDir("facade-test-");
    try {
      const agyPath = installFakeAgy(binDir, "auth-error");
      const result = await runAntigravityTask(binDir, {
        prompt: "x",
        binary: agyPath,
        timeoutMs: 10_000
      });
      assert.equal(result.ok, false);
      assert.ok(result.failureMessage.includes("not authenticated"));
    } finally {
      cleanTempDir(binDir);
    }
  });

  it("prepends a warning when a read-only task modifies the working tree", async () => {
    const repoDir = createTempDir("facade-readonly-");
    const binDir = createTempDir("facade-bin-");
    try {
      initGitRepo(repoDir);
      const agyPath = installFakeAgy(binDir, "write-file");
      const result = await runAntigravityTask(repoDir, {
        prompt: "x",
        write: false,
        binary: agyPath,
        timeoutMs: 10_000
      });
      assert.equal(result.ok, true);
      assert.ok(result.rawOutput.includes("WARNING: this read-only task modified the working tree"));
      assert.ok(result.rawOutput.includes("agy-wrote.txt"));
    } finally {
      cleanTempDir(repoDir);
      cleanTempDir(binDir);
    }
  });
});
