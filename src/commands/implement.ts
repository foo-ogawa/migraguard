import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";
import type { MigraguardConfig } from "../config.js";
import { resolveFromConfig } from "../config.js";
import { buildImplementContext } from "../agents/context-builder.js";
import {
  runAgentTask,
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
  dryRun?: boolean;
  failOn?: "warning" | "error" | "critical";
  output?: string;
  reportFormat?: ReportFormat;
  outputDir?: string;
}

export async function commandImplement(
  config: MigraguardConfig,
  description: string,
  opts: CommandImplementOptions,
): Promise<void | string> {
  const context = await buildImplementContext(description, config);

  if (opts.dryRun) return context;

  const auditConfig: AuditConfig = {
    adapter: opts.adapter,
    model: opts.model,
  };

  const auditOpts: AuditOptions = {
    failOn: opts.failOn,
  };

  try {
    const result = await runAgentTask(
      context,
      "implement-migration",
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
