import chalk from "chalk";
import type { MigraguardConfig } from "../config.js";
import { buildAuditWorkflowContext } from "../agents/context-builder.js";
import {
  runAgentTask,
  computeExitCode,
  formatResult,
  writeOutput,
  EXIT_RUNTIME_MISSING,
  EXIT_ADAPTER_ERROR,
} from "../agents/index.js";
import type { AuditConfig, AuditOptions, ReportFormat } from "../agents/index.js";

export interface CommandAuditWorkflowOptions {
  adapter?: string;
  model?: string;
  dryRun?: boolean;
  failOn?: "warning" | "error" | "critical";
  output?: string;
  reportFormat?: ReportFormat;
}

export async function commandAuditWorkflow(
  config: MigraguardConfig,
  opts: CommandAuditWorkflowOptions,
): Promise<void | string> {
  const context = await buildAuditWorkflowContext(config);

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
      "audit-workflow-compliance",
      auditConfig,
      auditOpts,
    );

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
