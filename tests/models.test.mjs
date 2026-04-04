import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveModel, suggestAlternatives, MODEL_ALIASES } from "../plugins/gemini/scripts/lib/models.mjs";

describe("resolveModel", () => {
  it("resolves 'flash' alias", () => {
    assert.equal(resolveModel("flash"), "gemini-2.5-flash");
  });

  it("resolves 'pro' alias", () => {
    assert.equal(resolveModel("pro"), "gemini-2.5-pro");
  });

  it("resolves 'flash-lite' alias", () => {
    assert.equal(resolveModel("flash-lite"), "gemini-2.5-flash-lite");
  });

  it("resolves 'flash-3' alias", () => {
    assert.equal(resolveModel("flash-3"), "gemini-3-flash");
  });

  it("resolves 'pro-3' alias", () => {
    assert.equal(resolveModel("pro-3"), "gemini-3.1-pro");
  });

  it("passes through unknown model names", () => {
    assert.equal(resolveModel("gemini-custom-model"), "gemini-custom-model");
  });

  it("returns null for null input", () => {
    assert.equal(resolveModel(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(resolveModel(""), null);
  });

  it("is case-insensitive", () => {
    assert.equal(resolveModel("Flash"), "gemini-2.5-flash");
    assert.equal(resolveModel("PRO"), "gemini-2.5-pro");
  });
});

describe("suggestAlternatives", () => {
  it("returns aliases excluding the failed model", () => {
    const suggestions = suggestAlternatives("gemini-2.5-flash");
    assert.ok(suggestions.length > 0);
    assert.ok(!suggestions.includes("flash"));
  });

  it("returns all aliases when failed model is unknown", () => {
    const suggestions = suggestAlternatives("unknown-model");
    assert.ok(suggestions.length === MODEL_ALIASES.size);
  });
});
