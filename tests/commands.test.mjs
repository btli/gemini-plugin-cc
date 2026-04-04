import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, splitRawArgumentString } from "../plugins/gemini/scripts/lib/args.mjs";

describe("parseArgs", () => {
  it("parses boolean options", () => {
    const result = parseArgs(["--wait", "--background"], {
      booleanOptions: new Set(["wait", "background"])
    });
    assert.deepEqual(result.options, { wait: true, background: true });
    assert.deepEqual(result.positionals, []);
  });

  it("parses value options", () => {
    const result = parseArgs(["--base", "main", "--model", "pro"], {
      valueOptions: new Set(["base", "model"])
    });
    assert.deepEqual(result.options, { base: "main", model: "pro" });
    assert.deepEqual(result.positionals, []);
  });

  it("collects positionals", () => {
    const result = parseArgs(["--wait", "investigate", "the", "bug"], {
      booleanOptions: new Set(["wait"])
    });
    assert.equal(result.options.wait, true);
    assert.deepEqual(result.positionals, ["investigate", "the", "bug"]);
  });

  it("handles inline values with =", () => {
    const result = parseArgs(["--base=main"], {
      valueOptions: new Set(["base"])
    });
    assert.equal(result.options.base, "main");
  });

  it("respects -- passthrough", () => {
    const result = parseArgs(["--wait", "--", "--not-a-flag"], {
      booleanOptions: new Set(["wait"])
    });
    assert.equal(result.options.wait, true);
    assert.deepEqual(result.positionals, ["--not-a-flag"]);
  });

  it("uses alias map", () => {
    const result = parseArgs(["-b", "main"], {
      valueOptions: new Set(["base"]),
      aliasMap: { b: "base" }
    });
    assert.equal(result.options.base, "main");
  });

  it("throws on missing value", () => {
    assert.throws(() => {
      parseArgs(["--base"], { valueOptions: new Set(["base"]) });
    }, /Missing value/);
  });
});

describe("splitRawArgumentString", () => {
  it("splits simple words", () => {
    assert.deepEqual(splitRawArgumentString("hello world"), ["hello", "world"]);
  });

  it("handles quoted strings", () => {
    assert.deepEqual(splitRawArgumentString('hello "big world"'), ["hello", "big world"]);
  });

  it("handles single quotes", () => {
    assert.deepEqual(splitRawArgumentString("hello 'big world'"), ["hello", "big world"]);
  });

  it("handles escaped characters", () => {
    assert.deepEqual(splitRawArgumentString("hello\\ world"), ["hello world"]);
  });

  it("handles empty input", () => {
    assert.deepEqual(splitRawArgumentString(""), []);
  });
});
