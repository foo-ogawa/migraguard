import { describe, it, expect } from "vitest";
import { buildAuditContext, buildProposeExpandContractContext, buildExplainContext } from "../../src/agents/context-builder.js";
import type { MigraguardConfig } from "../../src/config.js";
import { resolve } from "node:path";

const exampleDir = resolve(import.meta.dirname, "../../examples/social-app");

function makeConfig(overrides: Partial<MigraguardConfig> = {}): MigraguardConfig {
  return {
    configDir: exampleDir,
    dialect: "postgresql",
    migrationsDirs: ["db/migrations"],
    schemaFile: "db/schema.sql",
    metadataFile: "db/metadata.json",
    naming: {
      pattern: "{timestamp}__{description}.sql",
      timestamp: "YYYYMMDD_HHMMSS",
      prefix: "",
      sortKey: "timestamp",
    },
    connection: { host: "localhost", port: 5432, database: "test", user: "test" },
    dump: { normalize: true, excludeOwners: true, excludePrivileges: true },
    lint: { rules: {} },
    ...overrides,
  };
}

describe("buildAuditContext", () => {
  it("includes project configuration", async () => {
    const config = makeConfig();
    const ctx = await buildAuditContext(undefined, config);

    expect(ctx).toContain("# Migration Safety Audit Request");
    expect(ctx).toContain("Dialect: postgresql");
    expect(ctx).toContain("Model: linear");
  });

  it("includes SQL content from migration files", async () => {
    const config = makeConfig();
    const ctx = await buildAuditContext(undefined, config);

    expect(ctx).toContain("```sql");
    expect(ctx).toContain("CREATE TABLE");
  });

  it("includes lint violations when present", async () => {
    const config = makeConfig();
    const ctx = await buildAuditContext(undefined, config);

    expect(ctx).toContain("Existing Lint Violations");
  });

  it("handles a specific file target", async () => {
    const file = resolve(exampleDir, "db/migrations/20260301_100000__create_users_table.sql");
    const config = makeConfig();
    const ctx = await buildAuditContext(file, config);

    expect(ctx).toContain("create_users_table.sql");
    expect(ctx).toContain("CREATE TABLE IF NOT EXISTS users");
  });
});

describe("buildProposeExpandContractContext", () => {
  it("includes source migration SQL", async () => {
    const file = resolve(exampleDir, "db/migrations/20260301_100000__create_users_table.sql");
    const config = makeConfig();
    const ctx = await buildProposeExpandContractContext(file, config);

    expect(ctx).toContain("# Expand/Contract Proposal Request");
    expect(ctx).toContain("Source Migration:");
    expect(ctx).toContain("```sql");
    expect(ctx).toContain("Instructions");
    expect(ctx).toContain("expand");
    expect(ctx).toContain("contract");
  });
});

describe("buildExplainContext", () => {
  it("wraps stdin JSON in context", () => {
    const json = JSON.stringify({ ok: false, errors: 2 });
    const ctx = buildExplainContext(json, "lint");

    expect(ctx).toContain("# Command Result Explanation Request");
    expect(ctx).toContain("Source Command: `lint`");
    expect(ctx).toContain("```json");
    expect(ctx).toContain(json);
    expect(ctx).toContain("Instructions");
  });

  it("works without source command", () => {
    const json = JSON.stringify({ identical: false });
    const ctx = buildExplainContext(json);

    expect(ctx).toContain("# Command Result Explanation Request");
    expect(ctx).not.toContain("Source Command");
  });
});
