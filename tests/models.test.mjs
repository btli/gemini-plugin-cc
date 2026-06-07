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
