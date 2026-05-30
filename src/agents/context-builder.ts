import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { MigraguardConfig } from "../config.js";
import { resolveFromConfig } from "../config.js";
import { scanMigrations } from "../scanner.js";
import type { MigrationFile } from "../scanner.js";
import { ALL_RULES, runRules } from "../rules/index.js";
import type { RawViolation } from "../rules/index.js";

const MAX_CONTEXT_BYTES = 16 * 1024;

function capContext(context: string): string {
  if (context.length > MAX_CONTEXT_BYTES) {
    return context.slice(0, MAX_CONTEXT_BYTES) + "\n\n-- (context truncated at 16KB)";
  }
  return context;
}

export interface AuditTarget {
  filePath: string;
  fileName: string;
  sql: string;
  phase?: string;
  groupName?: string;
}

async function loadTargets(
  targetPath: string | undefined,
  config: MigraguardConfig,
): Promise<AuditTarget[]> {
  if (targetPath) {
    const { stat, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const info = await stat(targetPath);

    if (info.isDirectory()) {
      const entries = await readdir(targetPath);
      const sqlFiles = entries
        .filter((e) => e.endsWith(".sql"))
        .sort();

      if (sqlFiles.length > 0) {
        return Promise.all(
          sqlFiles.map(async (f) => {
            const filePath = join(targetPath, f);
            const sql = await readFile(filePath, "utf-8");
            const phase = f.match(/^(\d+)_(\w+)\.sql$/)?.[2];
            const groupName = basename(targetPath);
            return { filePath, fileName: f, sql, phase, groupName };
          }),
        );
      }

      const files = await scanMigrations({
        ...config,
        migrationsDirs: [targetPath],
      });
      return Promise.all(files.map(fileToTarget));
    }

    const sql = await readFile(targetPath, "utf-8");
    return [{ filePath: targetPath, fileName: basename(targetPath), sql }];
  }

  const files = await scanMigrations(config);
  return Promise.all(files.map(fileToTarget));
}

async function fileToTarget(f: MigrationFile): Promise<AuditTarget> {
  const sql = await readFile(f.filePath, "utf-8");
  return {
    filePath: f.filePath,
    fileName: f.fileName,
    sql,
    phase: f.phase,
    groupName: f.groupName,
  };
}

async function runLintOnTarget(
  target: AuditTarget,
  config: MigraguardConfig,
): Promise<RawViolation[]> {
  if (config.dialect !== "postgresql") return [];
  try {
    const activeRules = ALL_RULES.filter(
      (r) => (config.lint.rules[r.id] ?? "error") !== "off",
    );
    return await runRules(target.sql, activeRules);
  } catch {
    return [];
  }
}

/**
 * Extract schema sections relevant to the migration targets.
 * Instead of dumping the entire schema, we find CREATE TABLE blocks
 * for tables referenced (via REFERENCES, ALTER TABLE, INSERT INTO, etc.)
 * in the migration SQL.
 */
function extractRelevantSchema(schema: string, targets: AuditTarget[]): string | null {
  const allSql = targets.map((t) => t.sql).join("\n");

  const tableRefs = new Set<string>();
  const refPatterns = [
    /REFERENCES\s+(?:public\.)?(\w+)/gi,
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)/gi,
    /INSERT\s+INTO\s+(?:public\.)?(\w+)/gi,
    /UPDATE\s+(?:public\.)?(\w+)/gi,
    /FROM\s+(?:public\.)?(\w+)/gi,
    /JOIN\s+(?:public\.)?(\w+)/gi,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi,
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+.*?\bON\s+(?:public\.)?(\w+)/gi,
  ];

  for (const pat of refPatterns) {
    let m;
    while ((m = pat.exec(allSql)) !== null) {
      tableRefs.add(m[1].toLowerCase());
    }
  }

  if (tableRefs.size === 0) return null;

  const schemaBlocks = schema.split(/\n(?=CREATE\s)/i);
  const relevant: string[] = [];

  for (const block of schemaBlocks) {
    const tableMatch = block.match(
      /CREATE\s+TABLE\s+(?:public\.)?(\w+)/i,
    );
    if (tableMatch && tableRefs.has(tableMatch[1].toLowerCase())) {
      relevant.push(block.trim());
    }
  }

  if (relevant.length === 0) return null;

  const result = relevant.join("\n\n");
  if (result.length > 16000) {
    return result.slice(0, 16000) + "\n-- (truncated, showing referenced tables only)";
  }
  return result;
}

export async function buildAuditContext(
  targetPath: string | undefined,
  config: MigraguardConfig,
): Promise<string> {
  const targets = await loadTargets(targetPath, config);
  const sections: string[] = [];

  sections.push("# Migration Safety Audit Request");
  sections.push(
    `## Project Configuration\n\n` +
    `- Dialect: ${config.dialect}\n` +
    `- Model: ${config.model ?? "linear"}\n` +
    `- Migrations dirs: ${config.migrationsDirs.join(", ")}`,
  );

  for (const target of targets) {
    const fileSection: string[] = [];
    fileSection.push(`## Migration: ${target.fileName}`);

    if (target.phase) {
      fileSection.push(`Phase: ${target.phase} (group: ${target.groupName})`);
    }

    fileSection.push(`\n\`\`\`sql\n${target.sql}\n\`\`\``);

    const lintResults = await runLintOnTarget(target, config);
    if (lintResults.length > 0) {
      fileSection.push("\n### Existing Lint Violations");
      for (const v of lintResults) {
        fileSection.push(`- [${v.rule}] ${v.message} — hint: ${v.hint}`);
      }
    }

    sections.push(fileSection.join("\n"));
  }

  const schemaPath = resolveFromConfig(config, config.schemaFile);
  try {
    const schema = await readFile(schemaPath, "utf-8");
    if (schema.trim()) {
      const relevantSchema = extractRelevantSchema(schema, targets);
      if (relevantSchema) {
        sections.push(`## Relevant Schema Context (${config.schemaFile})\n\n\`\`\`sql\n${relevantSchema}\n\`\`\``);
      }
    }
  } catch {
    // schema.sql not available
  }

  return capContext(sections.join("\n\n"));
}

export async function buildProposeExpandContractContext(
  filePath: string,
  config: MigraguardConfig,
): Promise<string> {
  const sql = await readFile(filePath, "utf-8");
  const sections: string[] = [];

  sections.push("# Expand/Contract Proposal Request");
  sections.push(
    `## Project Configuration\n\n` +
    `- Dialect: ${config.dialect}\n` +
    `- Model: ${config.model ?? "linear"}`,
  );
  sections.push(`## Source Migration: ${basename(filePath)}\n\n\`\`\`sql\n${sql}\n\`\`\``);

  return capContext(sections.join("\n\n"));
}

/**
 * Build context for the implement-migration task.
 * Includes the natural language description, project config,
 * schema context, and naming convention guidance. Capped at 16KB.
 */
export async function buildImplementContext(
  description: string,
  config: MigraguardConfig,
): Promise<string> {
  const sections: string[] = [];

  sections.push("# Migration Implementation Request");
  sections.push(`## Description\n\n${description}`);
  sections.push(
    `## Project Configuration\n\n` +
    `- Dialect: ${config.dialect}\n` +
    `- Model: ${config.model ?? "linear"}\n` +
    `- Migrations dirs: ${config.migrationsDirs.join(", ")}\n` +
    `- Schema file: ${config.schemaFile}`,
  );

  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const slug = description.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 50);
  sections.push(
    `## Current UTC Context\n\n` +
    `Current UTC timestamp: ${ts}\n` +
    `Suggested file name: ${ts}__${slug}.sql`,
  );

  const schemaPath = resolveFromConfig(config, config.schemaFile);
  try {
    const schema = await readFile(schemaPath, "utf-8");
    if (schema.trim()) {
      const truncated = schema.length > 6000
        ? schema.slice(0, 6000) + "\n-- (schema truncated for context)"
        : schema;
      sections.push(`## Current Schema Context (${config.schemaFile})\n\n\`\`\`sql\n${truncated}\n\`\`\``);
    }
  } catch {
    // schema.sql not available; proceed without
  }

  try {
    const files = await scanMigrations(config);
    if (files.length > 0) {
      const recent = files.slice(-5).map((f) => `- ${f.fileName}`).join("\n");
      sections.push(`## Recent Migration Files (naming reference)\n\n${recent}`);
    }
  } catch {
    // migration scan failed; proceed without
  }

  return capContext(sections.join("\n\n"));
}

/**
 * Build context for the audit-workflow-compliance task.
 * Includes migration files, schema.sql status, lint results, and
 * group states. Capped at 16KB.
 */
export async function buildAuditWorkflowContext(
  config: MigraguardConfig,
): Promise<string> {
  const sections: string[] = [];

  sections.push("# Migration Workflow Audit Request");
  sections.push(
    `## Project Configuration\n\n` +
    `- Dialect: ${config.dialect}\n` +
    `- Model: ${config.model ?? "linear"}\n` +
    `- Migrations dirs: ${config.migrationsDirs.join(", ")}\n` +
    `- Schema file: ${config.schemaFile}\n` +
    `- Metadata file: ${config.metadataFile}`,
  );

  let migrationFiles: MigrationFile[] = [];
  try {
    migrationFiles = await scanMigrations(config);
    if (migrationFiles.length > 0) {
      const fileList = migrationFiles.map((f) => `- ${f.fileName}`).join("\n");
      sections.push(`## Migration Files (${migrationFiles.length} total)\n\n${fileList}`);

      let sqlBudget = 5000;
      const sqlSections: string[] = [];
      for (const f of migrationFiles.slice(-5)) {
        if (sqlBudget <= 0) break;
        try {
          const sql = await readFile(f.filePath, "utf-8");
          const excerpt = sql.length > 1200
            ? sql.slice(0, 1200) + "\n-- (truncated)"
            : sql;
          sqlSections.push(`### ${f.fileName}\n\n\`\`\`sql\n${excerpt}\n\`\`\``);
          sqlBudget -= excerpt.length;
        } catch {
          // skip unreadable files
        }
      }
      if (sqlSections.length > 0) {
        sections.push(
          `## Recent Migration SQL (last ${sqlSections.length} files)\n\n` +
          sqlSections.join("\n\n"),
        );
      }
    } else {
      sections.push("## Migration Files\n\nNo migration files found.");
    }
  } catch {
    sections.push("## Migration Files\n\nCould not read migration directory.");
  }

  const schemaPath = resolveFromConfig(config, config.schemaFile);
  try {
    const schema = await readFile(schemaPath, "utf-8");
    const hasPgDump = schema.includes("pg_dump") || schema.includes("PostgreSQL database dump");
    const hasMysqlDump = schema.includes("mysqldump") || schema.includes("MySQL dump");
    const hasMachineHeader = hasPgDump || hasMysqlDump || schema.includes("sqlite3 .schema");
    const firstLine = schema.split("\n")[0] ?? "";
    sections.push(
      `## Schema File (${config.schemaFile})\n\n` +
      `- Size: ${schema.length} bytes\n` +
      `- Machine-generated header detected: ${hasMachineHeader ? "YES" : "NO — possible manual edit"}\n` +
      `- First line: ${firstLine.slice(0, 120)}`,
    );
  } catch {
    sections.push(
      `## Schema File (${config.schemaFile})\n\n` +
      `File not found. Run \`migraguard dump\` to generate it.`,
    );
  }

  if (config.dialect === "postgresql" && migrationFiles.length > 0) {
    try {
      const violations: string[] = [];
      for (const f of migrationFiles) {
        const sql = await readFile(f.filePath, "utf-8");
        const activeRules = ALL_RULES.filter(
          (r) => (config.lint.rules[r.id] ?? "error") !== "off",
        );
        const results = await runRules(sql, activeRules);
        for (const v of results) {
          violations.push(`[${f.fileName}] ${v.rule}: ${v.message} — ${v.hint}`);
        }
      }
      if (violations.length > 0) {
        const limited = violations.slice(0, 30);
        const suffix = violations.length > 30 ? `\n  ... and ${violations.length - 30} more` : "";
        sections.push(
          `## Existing Lint Violations (${violations.length} total)\n\n` +
          limited.map((v) => `- ${v}`).join("\n") + suffix,
        );
      } else {
        sections.push("## Lint Results\n\nAll migration files pass lint checks.");
      }
    } catch {
      sections.push("## Lint Results\n\nCould not run lint analysis.");
    }
  }

  const metadataPath = resolveFromConfig(config, config.metadataFile);
  try {
    const raw = await readFile(metadataPath, "utf-8");
    const meta = JSON.parse(raw) as { files?: Array<{ fileName: string }> };
    const metaFiles = (meta.files ?? []).map((f) => f.fileName);
    const diskFiles = migrationFiles.map((f) => f.fileName);
    const missingFromDisk = metaFiles.filter((f) => !diskFiles.includes(f));
    const extraOnDisk = diskFiles.filter((f) => !metaFiles.includes(f));
    sections.push(
      `## Metadata File (${config.metadataFile})\n\n` +
      `- Entries in metadata: ${metaFiles.length}\n` +
      `- Files on disk: ${diskFiles.length}\n` +
      (missingFromDisk.length > 0
        ? `- Missing from disk: ${missingFromDisk.join(", ")}\n`
        : "") +
      (extraOnDisk.length > 0
        ? `- Extra on disk (not in metadata): ${extraOnDisk.join(", ")}\n`
        : "") +
      (missingFromDisk.length === 0 && extraOnDisk.length === 0
        ? "- Integrity: OK"
        : "- Integrity: MISMATCH"),
    );
  } catch {
    sections.push(
      `## Metadata File (${config.metadataFile})\n\n` +
      `File not found or unparseable. Run \`migraguard check\` to diagnose.`,
    );
  }

  return capContext(sections.join("\n\n"));
}

export function buildExplainContext(
  stdinJson: string,
  sourceCommand?: string,
): string {
  const sections: string[] = [];

  sections.push("# Command Result Explanation Request");

  if (sourceCommand) {
    sections.push(`## Source Command: \`${sourceCommand}\``);
  }

  sections.push(`## Command Output\n\n\`\`\`json\n${stdinJson}\n\`\`\``);

  return capContext(sections.join("\n\n"));
}
