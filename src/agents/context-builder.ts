import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { MigraguardConfig } from "../config.js";
import { resolveFromConfig } from "../config.js";
import { scanMigrations } from "../scanner.js";
import type { MigrationFile } from "../scanner.js";
import { ALL_RULES, runRules } from "../rules/index.js";
import type { RawViolation } from "../rules/index.js";

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

  return sections.join("\n\n");
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
  sections.push(
    "## Instructions\n\n" +
    "Decompose the above migration into an expand/contract migration group.\n" +
    "Each phase should be a separate SQL file with:\n" +
    "- expand: Add new structures (IF NOT EXISTS)\n" +
    "- backfill: Populate data (with WHERE, batching notes)\n" +
    "- switch: Application cutover documentation\n" +
    "- contract: Remove old structures (with migraguard:allow)\n\n" +
    "Include each phase's SQL in recommendedActions as edit_file entries.",
  );

  return sections.join("\n\n");
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
  sections.push(
    "## Instructions\n\n" +
    "Explain this migraguard command output in human-readable form.\n" +
    "The explanation should be suitable for:\n" +
    "- PR review comments\n" +
    "- Release decision documentation\n" +
    "- Incident communication\n\n" +
    "Provide concrete action items as recommendedActions.",
  );

  return sections.join("\n\n");
}
