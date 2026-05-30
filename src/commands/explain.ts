import chalk from "chalk";
import type { MigraguardConfig } from "../config.js";
import { buildExplainContext } from "../agents/context-builder.js";
import {
  runAgentTask,
  computeExitCode,
  formatResult,
  writeOutput,
  EXIT_RUNTIME_MISSING,
  EXIT_ADAPTER_ERROR,
} from "../agents/index.js";
import type { AuditConfig, AuditOptions, ReportFormat } from "../agents/index.js";

export interface CommandExplainOptions {
  adapter?: string;
  model?: string;
  dryRun?: boolean;
  failOn?: "warning" | "error" | "critical";
  output?: string;
  reportFormat?: ReportFormat;
}

export async function commandExplain(
  _config: MigraguardConfig,
  opts: CommandExplainOptions,
): Promise<void | string> {
  const stdin = await readStdin();
  if (!stdin.trim()) {
    console.error(chalk.red("Error: No input received on stdin."));
    console.error("Usage: migraguard lint --json | migraguard explain");
    process.exit(3);
  }

  const context = buildExplainContext(stdin);

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
      "explain-command-result",
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);

    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}
