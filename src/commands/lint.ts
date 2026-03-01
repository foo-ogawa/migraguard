import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';

const execFileAsync = promisify(execFile);

export interface LintResult {
  ok: boolean;
  filesLinted: number;
}

async function isSquawkAvailable(): Promise<boolean> {
  try {
    await execFileAsync('squawk', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function commandLint(config: MigraguardConfig): Promise<LintResult> {
  if (!config.lint.squawk) {
    console.log(chalk.yellow('Squawk lint is disabled in config.'));
    return { ok: true, filesLinted: 0 };
  }

  const available = await isSquawkAvailable();
  if (!available) {
    throw new Error(
      'Squawk is not installed or not in PATH. ' +
      'Install it: npm install -g squawk-cli  (or see https://squawkhq.com/)',
    );
  }

  const files = await scanMigrations(config);
  if (files.length === 0) {
    console.log(chalk.yellow('No migration files to lint.'));
    return { ok: true, filesLinted: 0 };
  }

  let hasErrors = false;

  for (const f of files) {
    try {
      await execFileAsync('squawk', [f.filePath]);
    } catch (err: unknown) {
      hasErrors = true;
      const execErr = err as { stdout?: string; stderr?: string };
      console.error(chalk.red(`\n✗ ${f.fileName}:`));
      if (execErr.stdout) console.error(execErr.stdout);
      if (execErr.stderr) console.error(execErr.stderr);
    }
  }

  if (hasErrors) {
    console.error(chalk.red(`\nLint failed.`));
  } else {
    console.log(chalk.green(`✓ ${files.length} file(s) passed lint.`));
  }

  return { ok: !hasErrors, filesLinted: files.length };
}
