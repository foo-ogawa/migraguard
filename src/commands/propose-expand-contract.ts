import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import chalk from "chalk";
import type { MigraguardConfig } from "../config.js";
import { buildProposeExpandContractContext } from "../agents/context-builder.js";
import {
  runAgentWorkflow,
  computeExitCode,
  formatResult,
  writeOutput,
  EXIT_RUNTIME_MISSING,
  EXIT_ADAPTER_ERROR,
} from "../agents/index.js";
import type { AuditConfig, AuditOptions, ReportFormat } from "../agents/index.js";

export interface CommandProposeOptions {
  adapter?: string;
  model?: string;
  dryRun?: boolean;
  failOn?: "warning" | "error" | "critical";
  output?: string;
  reportFormat?: ReportFormat;
  outputDir?: string;
  logFile?: string;
}

export async function commandProposeExpandContract(
  config: MigraguardConfig,
  file: string,
  opts: CommandProposeOptions,
): Promise<void | string> {
  const context = await buildProposeExpandContractContext(file, config);

  if (opts.dryRun) return context;

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
      "propose-expand-contract",
      "expand-contract-proposal",
      auditConfig,
      auditOpts,
    );

    if (result.data && opts.outputDir && result.data.recommendedActions) {
      const outDir = resolve(opts.outputDir);
      await mkdir(outDir, { recursive: true });

      for (const action of result.data.recommendedActions) {
        // target and command are present on most action types but not ExplainResult's
        const target = "target" in action ? action.target : undefined;
        const command = "command" in action ? action.command : undefined;
        if (action.kind === "edit_file" && target && command) {
          const outPath = join(outDir, basename(target));
          await writeFile(outPath, command, "utf-8");
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
