import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { ALL_RULES, runRules } from '../rules/index.js';
import type { LintRule, LintViolation } from '../rules/index.js';

export interface LintResult {
  ok: boolean;
  filesLinted: number;
  violations: number;
}

async function loadCustomRules(config: MigraguardConfig): Promise<LintRule[]> {
  const dir = config.lint.customRulesDir;
  if (!dir) return [];

  const absDir = resolveFromConfig(config, dir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return [];
  }

  const rules: LintRule[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.js') && !entry.endsWith('.mjs')) continue;
    const filePath = resolve(absDir, entry);
    try {
      const mod = await import(pathToFileURL(filePath).href);
      const rule: LintRule = mod.default ?? mod;
      if (rule && typeof rule.id === 'string' && typeof rule.create === 'function') {
        rules.push(rule);
      }
    } catch (err: unknown) {
      console.error(chalk.yellow(`Warning: failed to load custom rule from ${entry}: ${(err as Error).message}`));
    }
  }
  return rules;
}

export async function commandLint(config: MigraguardConfig): Promise<LintResult> {
  const files = await scanMigrations(config);
  if (files.length === 0) {
    console.log(chalk.yellow('No migration files to lint.'));
    return { ok: true, filesLinted: 0, violations: 0 };
  }

  const customRules = await loadCustomRules(config);
  const allRules = [...ALL_RULES, ...customRules];
  const enabledRules = allRules.filter((r) => config.lint.rules[r.id] !== false);

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
