import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import chalk from "chalk";
import type { MigraguardConfig } from "../config.js";
import { buildProposeExpandContractContext } from "../agents/context-builder.js";
import {
  runAgentTask,
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
  showPrompt?: boolean;
  failOn?: "warning" | "error" | "critical";
  output?: string;
  reportFormat?: ReportFormat;
  outputDir?: string;
}

export async function commandProposeExpandContract(
  config: MigraguardConfig,
  file: string,
  opts: CommandProposeOptions,
): Promise<void | string> {
  const context = await buildProposeExpandContractContext(file, config);

  if (opts.showPrompt) return context;

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
      "propose-expand-contract",
      auditConfig,
      auditOpts,
    );

    if (result.data && opts.outputDir && result.data.recommendedActions) {
      const outDir = resolve(opts.outputDir);
      await mkdir(outDir, { recursive: true });

      for (const action of result.data.recommendedActions) {
        if (action.kind === "edit_file" && action.target && action.command) {
          const outPath = join(outDir, basename(action.target));
          await writeFile(outPath, action.command, "utf-8");
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
