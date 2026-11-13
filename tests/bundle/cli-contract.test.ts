import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(__dirname, "..", "..");
const BUNDLE_PATH = join(ROOT, "dist", "migraguard.bundle.mjs");

const CLEAN_PG = [
  "SET lock_timeout = '5s';",
  "SET statement_timeout = '30s';",
  "CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);",
  "RESET lock_timeout;",
  "RESET statement_timeout;",
].join("\n");

/** Exit codes and stdout formats declared in cli-contract.yaml. */
describe("CLI contract", () => {
  let toolDir: string;
  let projectDir: string;

  beforeAll(() => {
    if (!existsSync(BUNDLE_PATH)) {
      execSync("node esbuild.bundle.mjs", { cwd: ROOT });
    }
    toolDir = mkdtempSync(join(tmpdir(), "migraguard-cli-tool-"));
    cpSync(BUNDLE_PATH, join(toolDir, "migraguard.bundle.mjs"));
    writeFileSync(join(toolDir, "package.json"), JSON.stringify({ name: "cli-contract-test", version: "1.0.0", type: "module" }));
    execSync("npm install pg better-sqlite3 libpg-query --legacy-peer-deps", { cwd: toolDir, stdio: "pipe" });
  }, 120_000);

  afterAll(() => {
    if (toolDir) rmSync(toolDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "migraguard-cli-project-"));
    mkdirSync(join(projectDir, "db", "migrations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function useConfig(config: Record<string, unknown>) {
    writeFileSync(join(projectDir, "migraguard.config.json"), JSON.stringify({ migrationsDir: "db/migrations", ...config }));
  }

  function useSqlite() {
    useConfig({ dialect: "sqlite", connection: { database: join(projectDir, "app.sqlite3") } });
  }

  function addFile(name: string, sql: string) {
    writeFileSync(join(projectDir, "db", "migrations", name), sql);
  }

  function cli(...args: string[]) {
    return spawnSync("node", [join(toolDir, "migraguard.bundle.mjs"), ...args], { cwd: projectDir, encoding: "utf8" });
  }

  function ok(...args: string[]) {
    const res = cli(...args);
    expect(res.status, `${args.join(" ")}: ${res.stderr}`).toBe(0);
    return res;
  }

  describe("lint", () => {
    beforeEach(() => useConfig({}));

    it("exits 10 with the violations as JSON on stdout", () => {
      addFile("20260301_120000__users.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);");

      const res = cli("lint", "--format", "json");
      expect(res.status).toBe(10);
      const out = JSON.parse(res.stdout) as { ok: boolean; violations: { file: string; rule: string }[] };
      expect(out.ok).toBe(false);
      expect(out.violations.every((v) => v.file === "20260301_120000__users.sql")).toBe(true);
      expect(out.violations.map((v) => v.rule)).toContain("require-if-not-exists");
    });

    it("exits 0 with the result as JSON on stdout", () => {
      addFile("20260301_120000__users.sql", CLEAN_PG);

      const res = cli("lint", "--format", "json");
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

      const res = cli("lint");
      expect(res.status).toBe(10);
      expect(res.stderr).toContain("require-if-not-exists");
    });

    it("exits 1 for an unsupported format", () => {
      addFile("20260301_120000__users.sql", CLEAN_PG);

      const res = cli("lint", "--format", "xml");
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Unsupported format");
    });
  });

  describe("check", () => {
    beforeEach(() => useConfig({}));

    it("exits 10 when a recorded file was changed", () => {
      addFile("20260301_120000__a.sql", "CREATE TABLE IF NOT EXISTS a (id INT);");
      ok("squash");
      addFile("20260302_120000__b.sql", "CREATE TABLE IF NOT EXISTS b (id INT);");
      ok("squash");
      ok("check");

      addFile("20260301_120000__a.sql", "CREATE TABLE IF NOT EXISTS a (id INT, x INT);");
      const res = cli("check");
      expect(res.status).toBe(10);
      expect(res.stderr).toContain("Checksum mismatch");
    });
  });

  describe("sqlite runtime commands", () => {
    beforeEach(() => useSqlite());

    it("status --format json prints the file states", () => {
      addFile("20260301_120000__a.sql", "CREATE TABLE IF NOT EXISTS a (id INTEGER);");

      const res = ok("status", "--format", "json");
      const out = JSON.parse(res.stdout) as { entries: { fileName: string; status: string }[]; groups: unknown[]; baselines: unknown[] };
      expect(out.entries.map((e) => [e.fileName, e.status])).toEqual([["20260301_120000__a.sql", "pending"]]);
      expect(out.groups).toEqual([]);
      expect(out.baselines).toEqual([]);
    });

    it("diff exits 0 when in sync and 10 on drift, with JSON on stdout", () => {
      addFile("20260301_120000__a.sql", "CREATE TABLE IF NOT EXISTS a (id INTEGER);");
      ok("apply");
      ok("dump");

      const same = ok("diff", "--format", "json");
      expect(JSON.parse(same.stdout)).toEqual({ identical: true, diff: "" });

      const schemaPath = join(projectDir, "db", "schema.sql");
      writeFileSync(schemaPath, readFileSync(schemaPath, "utf8").replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS legacy (id INTEGER);\nCREATE TABLE"));
      const drift = cli("diff", "--format", "json");
      expect(drift.status).toBe(10);
      const out = JSON.parse(drift.stdout) as { identical: boolean; diff: string };
      expect(out.identical).toBe(false);
      expect(out.diff).toContain("- CREATE TABLE IF NOT EXISTS legacy (id INTEGER);");
    });

    it("verify exits 10 when a migration is not idempotent, with JSON on stdout", () => {
      addFile("20260301_120000__a.sql", "CREATE TABLE a (id INTEGER);");

      const res = cli("verify", "--all", "--format", "json");
      expect(res.status).toBe(10);
      const out = JSON.parse(res.stdout) as { passed: number; failed: number; files: { fileName: string; passed: boolean }[] };
      expect(out.failed).toBe(1);
      expect(out.files).toEqual([expect.objectContaining({ fileName: "20260301_120000__a.sql", passed: false })]);
    });

    it("verify exits 0 when every migration is idempotent, with JSON on stdout", () => {
      addFile("20260301_120000__a.sql", "CREATE TABLE IF NOT EXISTS a (id INTEGER);");

      const res = ok("verify", "--all", "--format", "json");
      const out = JSON.parse(res.stdout) as { passed: number; failed: number };
      expect(out).toMatchObject({ passed: 1, failed: 0 });
    });

    it("gate exits 10 when a condition is not met and 0 when all are", () => {
      const unmet = cli("gate", "--require", "group:rename_x.expand_applied");
      expect(unmet.status).toBe(10);
      expect(unmet.stderr).toContain("Required condition not met");

      ok("gate", "--forbid", "group:rename_x.contract_completed");
    });

    it("gate exits 1 for a condition it cannot evaluate instead of passing it", () => {
      const res = cli("gate", "--forbid", "group:rename_x.contract_pending");
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Invalid gate condition");
    });
  });
});
