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
