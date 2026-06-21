import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import chalk from "chalk";
import type { MigraguardConfig } from "../config.js";
import { resolveFromConfig } from "../config.js";
import { buildImplementContext } from "../agents/context-builder.js";
import {
  runAgentWorkflow,
  computeExitCode,
  formatResult,
  writeOutput,
  EXIT_RUNTIME_MISSING,
  EXIT_ADAPTER_ERROR,
} from "../agents/index.js";
import type { AuditConfig, AuditOptions, ReportFormat } from "../agents/index.js";
import type { ImplementMigrationResult } from "../generated/dsl/handoffs.js";

export interface CommandImplementOptions {
  adapter?: string;
  model?: string;
  showPrompt?: boolean;
  failOn?: "warning" | "error" | "critical";
  output?: string;
  reportFormat?: ReportFormat;
  outputDir?: string;
  logFile?: string;
}

export async function commandImplement(
  config: MigraguardConfig,
  description: string,
  opts: CommandImplementOptions,
): Promise<void | string> {
  const context = await buildImplementContext(description, config);

  if (opts.showPrompt) return context;

  const auditConfig: AuditConfig = {
    adapter: opts.adapter,
    model: opts.model,
  };

  const auditOpts: AuditOptions = {
    failOn: opts.failOn,
    logFile: opts.logFile,
  };

  try {
    const result = await runAgentWorkflow(
      context,
      "implement-migration",
      "migration-implementation",
      auditConfig,
      auditOpts,
    );

    if (result.data) {
      const implData = result.data as ImplementMigrationResult;
      if (implData.migrations && implData.migrations.length > 0) {
        const outDir = opts.outputDir
          ? resolve(opts.outputDir)
          : resolveFromConfig(config, config.migrationsDirs[0]);
        await mkdir(outDir, { recursive: true });

        for (const migration of implData.migrations) {
          if (!/^[0-9A-Za-z_][0-9A-Za-z_.-]*\.sql$/.test(migration.fileName) || migration.fileName.includes('/') || migration.fileName.includes('\\')) {
            throw new Error(`Invalid migration file name from LLM output: ${migration.fileName}`);
          }
          const resolvedOut = resolve(outDir, migration.fileName);
          if (!resolvedOut.startsWith(resolve(outDir) + sep)) {
            throw new Error(`Path traversal detected in migration file name: ${migration.fileName}`);
          }
          const outPath = join(outDir, migration.fileName);
          await writeFile(outPath, migration.sql, "utf-8");
          console.log(chalk.green(`  Created: ${outPath}`));
        }
      }
    }

    const content = formatResult(result, opts.reportFormat ?? "json");
    await writeOutput(content, opts.output);

    const exitCode = computeExitCode(result, auditOpts);
    if (exitCode !== 0) process.exit(exitCode);
  } catch (err: unknown) {
    const exitCode = (err as { exitCode?: number }).exitCode;
    if (exitCode === EXIT_RUNTIME_MISSING) {
      console.error(chalk.red((err as Error).message));
      process.exit(EXIT_RUNTIME_MISSING);
    }
    if (exitCode === EXIT_ADAPTER_ERROR) {
      console.error(chalk.red((err as Error).message));
      process.exit(EXIT_ADAPTER_ERROR);
    }
    throw err;
  }
}
