import { Command } from 'commander';
import chalk from 'chalk';
import { pkg } from '../index.js';
import { loadConfig } from '../config.js';
import { commandNew } from '../commands/new.js';
import { commandCheck } from '../commands/check.js';
import { commandSquash } from '../commands/squash.js';
import { commandLint } from '../commands/lint.js';
import { commandEditable } from '../commands/editable.js';
import { commandApply } from '../commands/apply.js';
import { commandStatus } from '../commands/status.js';
import { commandResolve } from '../commands/resolve.js';
import { commandDump } from '../commands/dump.js';
import { commandDiff } from '../commands/diff.js';
import { commandVerify } from '../commands/verify.js';
import { commandDeps } from '../commands/deps.js';
import { commandGroupStatus } from '../commands/group-status.js';
import { commandAdvance } from '../commands/advance.js';
import { commandApplyPhase } from '../commands/apply-phase.js';
import { commandGate } from '../commands/gate.js';
import { commandBaseline } from '../commands/baseline.js';
import { commandAudit } from '../commands/audit.js';
import { commandProposeExpandContract } from '../commands/propose-expand-contract.js';
import { commandExplain } from '../commands/explain.js';
import type { Phase } from '../naming.js';

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

const program = new Command();

program
  .name(pkg.name)
  .description(pkg.description)
  .version(pkg.version);

program
  .command('new <name>')
  .description('Create a new migration SQL file with UTC timestamp')
  .option('--expand-contract', 'Create an expand/contract migration group (Class B)')
  .action((name: string, opts: { expandContract?: boolean }) => run(async () => {
    const config = await loadConfig();
    await commandNew(config, name, { expandContract: opts.expandContract });
  }));

program
  .command('apply')
  .description('Apply pending migrations via psql')
  .option('--with-drift-check', 'Check schema drift before apply and update dump after')
  .option('--from-baseline', 'Apply schema.sql first, then remaining migrations')
  .option('--tag <text>', 'Tag to record with applied migrations (e.g. commit hash, release tag)')
  .action((opts: { withDriftCheck?: boolean; fromBaseline?: boolean; tag?: string }) => run(async () => {
    const config = await loadConfig();
    const result = await commandApply(config, {
      withDriftCheck: opts.withDriftCheck,
      fromBaseline: opts.fromBaseline,
      tag: opts.tag,
    });
    if (result.errors.length > 0) process.exit(1);
  }));

program
  .command('check')
  .description('Verify metadata integrity (no DB connection required)')
  .action(() => run(async () => {
    const config = await loadConfig();
    const result = await commandCheck(config);
    if (!result.ok) process.exit(1);
  }));

program
  .command('squash')
  .description('Squash multiple new migration files into one')
  .action(() => run(async () => {
    const config = await loadConfig();
    await commandSquash(config);
  }));

program
  .command('lint')
  .description('Run built-in safety rules on migration files')
  .action(() => run(async () => {
    const config = await loadConfig();
    const result = await commandLint(config);
    if (!result.ok) process.exit(1);
  }));

program
  .command('dump')
  .description('Dump and normalize current DB schema')
  .action(() => run(async () => {
    const config = await loadConfig();
    await commandDump(config);
  }));

program
  .command('diff')
  .description('Show diff between current DB schema and saved schema.sql')
  .action(() => run(async () => {
    const config = await loadConfig();
    const result = await commandDiff(config);
    if (!result.identical) process.exit(1);
  }));

program
  .command('status')
  .description('Show migration status (applied / pending / failed / skipped)')
  .action(() => run(async () => {
    const config = await loadConfig();
    await commandStatus(config);
  }));

program
  .command('resolve <file>')
  .description('Mark a failed migration as skipped (requires human judgment)')
  .action((file: string) => run(async () => {
    const config = await loadConfig();
    await commandResolve(config, file);
  }));

program
  .command('editable')
  .description('List migration files that are currently editable (leaf nodes or latest file)')
  .action(() => run(async () => {
    const config = await loadConfig();
    await commandEditable(config);
  }));

program
  .command('verify')
  .description('Verify migration idempotency using a shadow DB')
  .option('--all', 'Verify all migrations from scratch (not just pending)')
  .action((opts: { all?: boolean }) => run(async () => {
    const config = await loadConfig();
    const result = await commandVerify(config, { all: opts.all });
    if (result.failed > 0) process.exit(1);
  }));

program
  .command('group-status [group]')
  .description('Show migration group state (expand/contract phases)')
  .action((group?: string) => run(async () => {
    const config = await loadConfig();
    await commandGroupStatus(config, group);
  }));

program
  .command('baseline')
  .description('Squash applied migrations into schema.sql baseline')
  .option('--keep-since <file...>', 'Keep files from this point forward')
  .action((opts: { keepSince?: string[] }) => run(async () => {
    const config = await loadConfig();
    const result = await commandBaseline(config, { keepSince: opts.keepSince });
    if (!result.success) process.exit(1);
  }));

program
  .command('advance <group> <phase> <status>')
  .description('Record a phase state transition (for external executor)')
  .option('--tag <text>', 'Tag to record (e.g. commit hash, release tag)')
  .action((group: string, phase: string, status: string, opts: { tag?: string }) => run(async () => {
    const config = await loadConfig();
    const validPhases = ['expand', 'backfill', 'switch', 'contract'];
    const validStatuses = ['running', 'completed', 'failed'];
    if (!validPhases.includes(phase)) throw new Error(`Invalid phase: ${phase}`);
    if (!validStatuses.includes(status)) throw new Error(`Invalid status: ${status}`);
    const result = await commandAdvance(config, {
      group,
      phase: phase as Phase,
      status: status as 'running' | 'completed' | 'failed',
      tag: opts.tag,
    });
    if (!result.success) process.exit(1);
  }));

program
  .command('apply-phase <group> <phase>')
  .description('Apply a specific phase of a migration group via psql')
  .option('--tag <text>', 'Tag to record (e.g. commit hash, release tag)')
  .action((group: string, phase: string, opts: { tag?: string }) => run(async () => {
    const config = await loadConfig();
    const validPhases = ['expand', 'backfill', 'switch', 'contract'];
    if (!validPhases.includes(phase)) throw new Error(`Invalid phase: ${phase}`);
    const result = await commandApplyPhase(config, {
      group,
      phase: phase as Phase,
      tag: opts.tag,
    });
    if (!result.success) process.exit(1);
  }));

program
  .command('gate')
  .description('Evaluate deployment gate conditions against migration group states')
  .option('--require <condition...>', 'Required schema state conditions')
  .option('--forbid <condition...>', 'Forbidden schema state conditions')
  .option('--contract-file <path>', 'JSON file with schema requirements')
  .action((opts: { require?: string[]; forbid?: string[]; contractFile?: string }) => run(async () => {
    const config = await loadConfig();
    const result = await commandGate(config, {
      required: opts.require,
      forbidden: opts.forbid,
      contractFile: opts.contractFile,
    });
    if (!result.pass) process.exit(1);
  }));

program
  .command('deps')
  .description('Analyze and display migration dependency graph')
  .option('--html <path>', 'Output as HTML file with GitGraph.js visualization')
  .action((opts: { html?: string }) => run(async () => {
    const config = await loadConfig();
    const result = await commandDeps(config, { html: opts.html });
    if (!result.ok) process.exit(1);
  }));

program
  .command('audit [target]')
  .description('Run LLM-based migration safety audit')
  .option('-a, --adapter <name>', 'SDK adapter (cursor, claude, openai, gemini, mock)')
  .option('--model <name>', 'LLM model override')
  .option('-n, --dry-run', 'Output prompt without calling LLM')
  .option('--fail-on <level>', 'Minimum severity for non-zero exit (warning, error, critical)', 'error')
  .option('--report-format <fmt>', 'Output format (text, json)', 'text')
  .action((target: string | undefined, opts: {
    adapter?: string; model?: string; dryRun?: boolean;
    failOn?: string; reportFormat?: string;
  }) => run(async () => {
    const config = await loadConfig();
    await commandAudit(config, target, {
      adapter: opts.adapter,
      model: opts.model,
      dryRun: opts.dryRun,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      reportFormat: opts.reportFormat as 'text' | 'json' | undefined,
    });
  }));

program
  .command('propose-expand-contract <file>')
  .description('Propose expand/contract migration group from unsafe DDL')
  .option('-a, --adapter <name>', 'SDK adapter (cursor, claude, openai, gemini, mock)')
  .option('--model <name>', 'LLM model override')
  .option('-n, --dry-run', 'Output prompt without calling LLM')
  .option('--output-dir <dir>', 'Directory to write proposed phase files')
  .action((file: string, opts: {
    adapter?: string; model?: string; dryRun?: boolean; outputDir?: string;
  }) => run(async () => {
    const config = await loadConfig();
    await commandProposeExpandContract(config, file, opts);
  }));

program
  .command('explain')
  .description('Explain command output in human-readable form using LLM')
  .option('-a, --adapter <name>', 'SDK adapter (cursor, claude, openai, gemini, mock)')
  .option('--model <name>', 'LLM model override')
  .option('-n, --dry-run', 'Output prompt without calling LLM')
  .action((opts: { adapter?: string; model?: string; dryRun?: boolean }) => run(async () => {
    const config = await loadConfig();
    await commandExplain(config, opts);
  }));

program.parse();
