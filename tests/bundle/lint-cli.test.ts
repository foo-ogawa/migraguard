import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(__dirname, "..", "..");
const BUNDLE_PATH = join(ROOT, "dist", "migraguard.bundle.mjs");

const CLEAN = [
  "SET lock_timeout = '5s';",
  "SET statement_timeout = '30s';",
  "CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);",
  "RESET lock_timeout;",
  "RESET statement_timeout;",
].join("\n");

describe("lint CLI contract", () => {
  let projectDir: string;

  beforeAll(() => {
    if (!existsSync(BUNDLE_PATH)) {
      execSync("node esbuild.bundle.mjs", { cwd: ROOT });
    }
  });

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "migraguard-lint-cli-"));
    mkdirSync(join(projectDir, "db", "migrations"), { recursive: true });
    writeFileSync(join(projectDir, "migraguard.config.json"), JSON.stringify({ migrationsDir: "db/migrations" }));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function lint(...args: string[]) {
    return spawnSync("node", [BUNDLE_PATH, "lint", ...args], { cwd: projectDir, encoding: "utf8" });
  }

  function addFile(name: string, sql: string) {
    writeFileSync(join(projectDir, "db", "migrations", name), sql);
  }

  it("exits 10 with the violations as JSON on stdout", () => {
    addFile("20260301_120000__users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");

    const res = lint("--format", "json");
    expect(res.status).toBe(10);
    const out = JSON.parse(res.stdout) as { ok: boolean; violations: { file: string; rule: string }[] };
    expect(out.ok).toBe(false);
    expect(out.violations.length).toBeGreaterThan(0);
    expect(out.violations.every((v) => v.file === "20260301_120000__users.sql")).toBe(true);
    expect(out.violations.map((v) => v.rule)).toContain("require-if-not-exists");
  });

  it("exits 0 with the result as JSON on stdout", () => {
    addFile("20260301_120000__users.sql", CLEAN);

    const res = lint("--format", "json");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: true,
      filesLinted: 1,
      filesSkipped: 0,
      errors: 0,
      warnings: 0,
      violations: [],
    });
  });

  it("exits 10 in text format", () => {
    addFile("20260301_120000__users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");

    const res = lint();
    expect(res.status).toBe(10);
    expect(res.stderr).toContain("require-if-not-exists");
  });

  it("exits 1 for an unsupported format", () => {
    addFile("20260301_120000__users.sql", CLEAN);

    const res = lint("--format", "xml");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unsupported format");
  });
});
