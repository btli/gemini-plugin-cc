import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { binaryAvailable, terminateProcessTree, formatCommandFailure } from "../plugins/gemini/scripts/lib/process.mjs";

describe("binaryAvailable", () => {
  it("detects available binaries", () => {
    const result = binaryAvailable("node");
    assert.equal(result.available, true);
    assert.ok(result.detail.length > 0);
  });

  it("detects missing binaries", () => {
    const result = binaryAvailable("this-binary-should-not-exist-xyz123");
    assert.equal(result.available, false);
    assert.equal(result.detail, "not found");
  });
});

describe("terminateProcessTree", () => {
  it("handles non-finite pid gracefully", () => {
    const result = terminateProcessTree(NaN);
    assert.equal(result.attempted, false);
    assert.equal(result.delivered, false);
  });

  it("handles missing process gracefully on unix", () => {
    const result = terminateProcessTree(999999999, {
      platform: "linux",
      killImpl: () => {
        const err = new Error("ESRCH");
        err.code = "ESRCH";
        throw err;
      }
    });
    assert.equal(result.attempted, true);
    assert.equal(result.delivered, false);
  });
});

describe("formatCommandFailure", () => {
  it("formats basic failure", () => {
    const msg = formatCommandFailure({
      command: "gemini",
      args: ["--version"],
      status: 1,
      signal: null,
      stdout: "",
      stderr: "error occurred"
    });
    assert.ok(msg.includes("gemini"));
    assert.ok(msg.includes("exit=1"));
    assert.ok(msg.includes("error occurred"));
  });

  it("includes signal info", () => {
    const msg = formatCommandFailure({
      command: "gemini",
      args: [],
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: ""
    });
    assert.ok(msg.includes("signal=SIGTERM"));
  });
});
