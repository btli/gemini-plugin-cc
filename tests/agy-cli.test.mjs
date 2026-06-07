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
