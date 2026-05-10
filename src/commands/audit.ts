import chalk from "chalk";
import type { MigraguardConfig } from "../config.js";
import { buildAuditContext } from "../agents/context-builder.js";
import {
  runAgentTask,
  computeExitCode,
  formatResultText,
  formatResultJson,
  EXIT_RUNTIME_MISSING,
  EXIT_ADAPTER_ERROR,
} from "../agents/index.js";
import type { AuditConfig, AuditOptions } from "../agents/index.js";

export interface CommandAuditOptions {
  adapter?: string;
  model?: string;
  dryRun?: boolean;
  failOn?: "warning" | "error" | "critical";
  reportFormat?: "text" | "json";
}

export async function commandAudit(
  config: MigraguardConfig,
  target: string | undefined,
  opts: CommandAuditOptions,
): Promise<void> {
  const context = await buildAuditContext(target, config);

  const auditConfig: AuditConfig = {
    adapter: opts.adapter,
    model: opts.model,
  };

  const auditOpts: AuditOptions = {
    dryRun: opts.dryRun,
    failOn: opts.failOn,
  };

  try {
    const result = await runAgentTask(
      context,
      "audit-migration-safety",
      auditConfig,
      auditOpts,
    );

    const format = opts.reportFormat ?? "text";
    if (format === "json") {
      process.stdout.write(formatResultJson(result) + "\n");
    } else {
      process.stdout.write(formatResultText(result) + "\n");
    }

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
