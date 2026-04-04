import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractResultText, extractTextFromContent } from "../plugins/gemini/scripts/lib/gemini.mjs";

describe("extractTextFromContent", () => {
  it("returns string content directly", () => {
    assert.equal(extractTextFromContent("hello"), "hello");
  });

  it("extracts text from MCP-style content array", () => {
    const content = [
      { type: "text", text: "hello " },
      { type: "text", text: "world" }
    ];
    assert.equal(extractTextFromContent(content), "hello world");
  });

  it("filters out non-text entries", () => {
    const content = [
      { type: "text", text: "keep" },
      { type: "image", url: "img.png" },
      null,
      { type: "text", text: " this" }
    ];
    assert.equal(extractTextFromContent(content), "keep this");
  });

  it("returns empty string for non-array non-string", () => {
    assert.equal(extractTextFromContent(null), "");
    assert.equal(extractTextFromContent(undefined), "");
    assert.equal(extractTextFromContent(42), "");
  });

  it("returns empty string for empty array", () => {
    assert.equal(extractTextFromContent([]), "");
  });
});

describe("extractResultText", () => {
  it("returns empty string for null/undefined", () => {
    assert.equal(extractResultText(null), "");
    assert.equal(extractResultText(undefined), "");
  });

  it("returns empty string for non-object", () => {
    assert.equal(extractResultText("string"), "");
    assert.equal(extractResultText(42), "");
  });

  it("extracts direct text field", () => {
    assert.equal(extractResultText({ text: "direct" }), "direct");
  });

  it("skips empty text field and falls through to content", () => {
    const result = {
      text: "",
      content: [{ type: "text", text: "from content" }]
    };
    assert.equal(extractResultText(result), "from content");
  });

  it("extracts from content array", () => {
    const result = {
      content: [
        { type: "text", text: "part1 " },
        { type: "text", text: "part2" }
      ]
    };
    assert.equal(extractResultText(result), "part1 part2");
  });

  it("extracts from messages array with string content", () => {
    const result = {
      messages: [
        { role: "assistant", content: "hello " },
        { role: "assistant", content: "world" }
      ]
    };
    assert.equal(extractResultText(result), "hello world");
  });

  it("extracts from messages array with content arrays", () => {
    const result = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: "from messages" }] }
      ]
    };
    assert.equal(extractResultText(result), "from messages");
  });

  it("returns empty string for object with no recognized fields", () => {
    assert.equal(extractResultText({ stopReason: "end_turn" }), "");
  });

  it("returns empty string for empty content array", () => {
    assert.equal(extractResultText({ content: [] }), "");
  });

  it("returns empty string for empty messages array", () => {
    assert.equal(extractResultText({ messages: [] }), "");
  });
});
