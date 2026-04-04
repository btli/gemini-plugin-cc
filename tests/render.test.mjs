import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  renderSetupReport,
  renderReviewResult,
  renderTaskResult,
  renderCancelReport
} from "../plugins/gemini/scripts/lib/render.mjs";

describe("renderSetupReport", () => {
  it("renders ready status", () => {
    const output = renderSetupReport({
      ready: true,
      node: { available: true, detail: "v22.0.0" },
      npm: { available: true, detail: "10.0.0" },
      gemini: { available: true, detail: "0.36.0" },
      auth: { available: true, loggedIn: true, detail: "authenticated (Google OAuth)" },
      sessionRuntime: { label: "direct" },
      reviewGateEnabled: false,
      actionsTaken: [],
      nextSteps: []
    });
    assert.ok(output.includes("# Gemini Setup"));
    assert.ok(output.includes("Status: ready"));
    assert.ok(output.includes("gemini: 0.36.0"));
  });

  it("renders needs-attention status", () => {
    const output = renderSetupReport({
      ready: false,
      node: { available: true, detail: "v22.0.0" },
      npm: { available: true, detail: "10.0.0" },
      gemini: { available: false, detail: "not found" },
      auth: { available: false, loggedIn: false, detail: "gemini not installed" },
      sessionRuntime: { label: "direct" },
      reviewGateEnabled: false,
      actionsTaken: [],
      nextSteps: ["Install Gemini CLI"]
    });
    assert.ok(output.includes("Status: needs attention"));
    assert.ok(output.includes("Install Gemini CLI"));
  });
});

describe("renderReviewResult", () => {
  it("renders structured review", () => {
    const output = renderReviewResult(
      {
        parsed: {
          verdict: "needs-attention",
          summary: "Found one issue.",
          findings: [
            {
              severity: "high",
              title: "Bug",
              body: "There is a bug.",
              file: "test.js",
              line_start: 10,
              line_end: 10,
              confidence: 0.9,
              recommendation: "Fix it."
            }
          ],
          next_steps: ["Fix the bug."]
        },
        parseError: null,
        rawOutput: ""
      },
      { reviewLabel: "Review", targetLabel: "Working tree changes", reasoningSummary: null }
    );
    assert.ok(output.includes("# Gemini Review"));
    assert.ok(output.includes("Verdict: needs-attention"));
    assert.ok(output.includes("[high] Bug"));
    assert.ok(output.includes("test.js:10"));
  });

  it("renders parse error fallback", () => {
    const output = renderReviewResult(
      { parsed: null, parseError: "Bad JSON", rawOutput: "some text" },
      { reviewLabel: "Review", targetLabel: "Working tree changes", reasoningSummary: null }
    );
    assert.ok(output.includes("did not return valid structured JSON"));
    assert.ok(output.includes("Bad JSON"));
    assert.ok(output.includes("some text"));
  });
});

describe("renderTaskResult", () => {
  it("returns raw output", () => {
    const output = renderTaskResult({ rawOutput: "Task completed successfully." });
    assert.equal(output, "Task completed successfully.\n");
  });

  it("handles missing output", () => {
    const output = renderTaskResult({});
    assert.ok(output.includes("Gemini did not return a final message"));
  });
});

describe("renderCancelReport", () => {
  it("renders cancel confirmation", () => {
    const output = renderCancelReport({ id: "abc123", title: "Test job", summary: "Testing" });
    assert.ok(output.includes("# Gemini Cancel"));
    assert.ok(output.includes("Cancelled abc123"));
    assert.ok(output.includes("Test job"));
  });
});
