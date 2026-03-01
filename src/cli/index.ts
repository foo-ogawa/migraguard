import { Command } from 'commander';
import chalk from 'chalk';
import { VERSION } from '../index.js';
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
  .name('migraguard')
  .description('PostgreSQL migration guard — idempotent SQL migrations with CI-enforced integrity checks')
  .version(VERSION);

program
  .command('new <name>')
  .description('Create a new migration SQL file with UTC timestamp')
  .action((name: string) => run(async () => {
    const config = await loadConfig();
    await commandNew(config, name);
  }));

program
  .command('apply')
  .description('Apply pending migrations via psql')
  .option('--verify', 'Verify schema dump before and after apply')
  .action((opts: { verify?: boolean }) => run(async () => {
    const config = await loadConfig();
    const result = await commandApply(config, { verify: opts.verify });
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
  .description('Run Squawk lint on migration files')
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
  .command('deps')
  .description('Analyze and display migration dependency graph')
  .option('--html <path>', 'Output as HTML file with GitGraph.js visualization')
  .action((opts: { html?: string }) => run(async () => {
    const config = await loadConfig();
    const result = await commandDeps(config, { html: opts.html });
    if (!result.ok) process.exit(1);
  }));

program.parse();
