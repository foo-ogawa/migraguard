import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BUNDLE_PATH = join(__dirname, "..", "..", "dist", "migraguard.bundle.mjs");

describe("bundle-isolation", () => {
  let tempDir: string;

  beforeAll(() => {
    if (!existsSync(BUNDLE_PATH)) {
      execSync("node esbuild.bundle.mjs", { cwd: join(__dirname, "..", "..") });
    }

    tempDir = mkdtempSync(join(tmpdir(), "migraguard-test-"));
    cpSync(BUNDLE_PATH, join(tempDir, "migraguard.bundle.mjs"));

    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "bundle-test", version: "1.0.0", type: "module" }),
    );

    execSync(
      "npm install @openai/agents pg better-sqlite3 mysql2 libpg-query --legacy-peer-deps",
      { cwd: tempDir, stdio: "pipe" },
    );
  }, 60_000);

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts without agent-contracts-runtime installed globally", () => {
    const output = execFileSync("node", ["migraguard.bundle.mjs", "--version"], {
      cwd: tempDir,
      encoding: "utf8",
    });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("constructs LLM prompt from isolated directory (--show-prompt)", () => {
    const output = execFileSync(
      "node",
      ["migraguard.bundle.mjs", "audit", "--adapter", "openai", "--show-prompt"],
      {
        cwd: tempDir,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(output).toBeTruthy();
    expect(output.length).toBeGreaterThan(100);
  }, 30_000);

  it("runs LLM audit with openai adapter", () => {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }

    const output = execFileSync(
      "node",
      ["migraguard.bundle.mjs", "audit", "--adapter", "openai"],
      {
        cwd: tempDir,
        encoding: "utf8",
        timeout: 90_000,
        env: { ...process.env, NODE_ENV: "test" },
      },
    );
    expect(output).toBeTruthy();
  }, 100_000);
});
