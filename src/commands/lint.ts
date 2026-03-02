import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { ALL_RULES, runRules } from '../rules/index.js';
import type { LintViolation } from '../rules/index.js';

export interface LintResult {
  ok: boolean;
  filesLinted: number;
  violations: number;
}

export async function commandLint(config: MigraguardConfig): Promise<LintResult> {
  const files = await scanMigrations(config);
  if (files.length === 0) {
    console.log(chalk.yellow('No migration files to lint.'));
    return { ok: true, filesLinted: 0, violations: 0 };
  }

  const enabledRules = ALL_RULES.filter((r) => config.lint.rules[r.id] !== false);

  if (enabledRules.length === 0) {
    console.log(chalk.yellow('All lint rules are disabled.'));
    return { ok: true, filesLinted: files.length, violations: 0 };
  }

  let totalViolations = 0;

  for (const f of files) {
    const sql = await readFile(f.filePath, 'utf-8');
    const violations = await runRules(sql, enabledRules);
    if (violations.length > 0) {
      totalViolations += violations.length;
      printViolations(f.fileName, violations);
    }
  }

  if (totalViolations > 0) {
    console.error(chalk.red(`\nLint failed: ${totalViolations} violation(s).`));
  } else {
    console.log(chalk.green(`✓ ${files.length} file(s) passed lint.`));
  }

  return { ok: totalViolations === 0, filesLinted: files.length, violations: totalViolations };
}

function printViolations(fileName: string, violations: LintViolation[]): void {
  console.error(chalk.red(`\n✗ ${fileName}:`));
  for (const v of violations) {
    console.error(chalk.red(`  [${v.rule}] ${v.message}`));
    console.error(chalk.gray(`    hint: ${v.hint}`));
  }
}
