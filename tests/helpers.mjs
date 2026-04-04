import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function createTempDir(prefix = "gemini-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanTempDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function initGitRepo(dirPath) {
  spawnSync("git", ["init"], { cwd: dirPath, stdio: "pipe" });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dirPath, stdio: "pipe" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dirPath, stdio: "pipe" });
  // Create initial commit
  fs.writeFileSync(path.join(dirPath, "README.md"), "# Test\n");
  spawnSync("git", ["add", "."], { cwd: dirPath, stdio: "pipe" });
  spawnSync("git", ["commit", "-m", "init"], { cwd: dirPath, stdio: "pipe" });
}

export function runCompanion(args, options = {}) {
  const scriptPath = path.resolve(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    "..",
    "plugins",
    "gemini",
    "scripts",
    "gemini-companion.mjs"
  );

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    stdio: "pipe"
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null
  };
}

export function writeFile(dirPath, name, content) {
  const filePath = path.join(dirPath, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}
