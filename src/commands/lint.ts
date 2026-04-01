import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import type { MigraguardConfig, RuleSeverity } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { ALL_RULES, runRules } from '../rules/index.js';
import type { LintRule, LintViolation } from '../rules/index.js';
import { ALL_GENERIC_RULES, runGenericRules } from '../generic/rules/index.js';
import type { GenericLintRule, GenericDialect } from '../generic/rules/index.js';

export interface LintResult {
  ok: boolean;
  filesLinted: number;
  errors: number;
  warnings: number;
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

function getSeverity(config: MigraguardConfig, ruleId: string): RuleSeverity {
  return config.lint.rules[ruleId] ?? 'error';
}

export async function commandLint(config: MigraguardConfig): Promise<LintResult> {
  if (config.dialect !== 'postgresql') {
    return commandLintGeneric(config);
  }
  return commandLintPg(config);
}

async function commandLintPg(config: MigraguardConfig): Promise<LintResult> {
  const files = await scanMigrations(config);
  if (files.length === 0) {
    console.log(chalk.yellow('No migration files to lint.'));
    return { ok: true, filesLinted: 0, errors: 0, warnings: 0 };
  }

  const customRules = await loadCustomRules(config);
  const allRules = [...ALL_RULES, ...customRules];
  const activeRules = allRules.filter((r) => getSeverity(config, r.id) !== 'off');

  if (activeRules.length === 0) {
    console.log(chalk.yellow('All lint rules are disabled.'));
    return { ok: true, filesLinted: files.length, errors: 0, warnings: 0 };
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const f of files) {
    const sql = await readFile(f.filePath, 'utf-8');

    const fileRules = activeRules.filter((r) => {
      if (!r.applicablePhases) return true;
      if (!f.phase) return false;
      return r.applicablePhases.includes(f.phase);
    });

    const raw = await runRules(sql, fileRules);
    if (raw.length === 0) continue;

    const violations: LintViolation[] = raw.map((v) => ({
      ...v,
      severity: getSeverity(config, v.rule) === 'warn' ? 'warn' : 'error',
    }));

    const fileErrors = violations.filter((v) => v.severity === 'error').length;
    const fileWarnings = violations.filter((v) => v.severity === 'warn').length;
    totalErrors += fileErrors;
    totalWarnings += fileWarnings;

    printViolations(f.fileName, violations);
  }

  printSummary(files.length, totalErrors, totalWarnings);

  return {
    ok: totalErrors === 0,
    filesLinted: files.length,
    errors: totalErrors,
    warnings: totalWarnings,
  };
}

async function commandLintGeneric(config: MigraguardConfig): Promise<LintResult> {
  const dialect = config.dialect as GenericDialect;
  const files = await scanMigrations(config);
  if (files.length === 0) {
    console.log(chalk.yellow('No migration files to lint.'));
    return { ok: true, filesLinted: 0, errors: 0, warnings: 0 };
  }

  const activeRules: GenericLintRule[] = ALL_GENERIC_RULES.filter(
    (r) => getSeverity(config, r.id) !== 'off',
  );

  if (activeRules.length === 0) {
    console.log(chalk.yellow('All lint rules are disabled.'));
    return { ok: true, filesLinted: files.length, errors: 0, warnings: 0 };
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const f of files) {
    const sql = await readFile(f.filePath, 'utf-8');

    const fileRules = activeRules.filter((r) => {
      if (!r.applicablePhases) return true;
      if (!f.phase) return false;
      return r.applicablePhases.includes(f.phase);
    });

    const raw = await runGenericRules(sql, fileRules, dialect);
    if (raw.length === 0) continue;

    const violations: LintViolation[] = raw.map((v) => ({
      ...v,
      severity: getSeverity(config, v.rule) === 'warn' ? 'warn' : 'error',
    }));

    const fileErrors = violations.filter((v) => v.severity === 'error').length;
    const fileWarnings = violations.filter((v) => v.severity === 'warn').length;
    totalErrors += fileErrors;
    totalWarnings += fileWarnings;

    printViolations(f.fileName, violations);
  }

  printSummary(files.length, totalErrors, totalWarnings);

  return {
    ok: totalErrors === 0,
    filesLinted: files.length,
    errors: totalErrors,
    warnings: totalWarnings,
  };
}

function printSummary(filesCount: number, errors: number, warnings: number): void {
  if (errors > 0 || warnings > 0) {
    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} error(s)`);
    if (warnings > 0) parts.push(`${warnings} warning(s)`);
    const summary = parts.join(', ');
    if (errors > 0) {
      console.error(chalk.red(`\nLint failed: ${summary}.`));
    } else {
      console.log(chalk.yellow(`\nLint: ${summary}.`));
    }
  } else {
    console.log(chalk.green(`✓ ${filesCount} file(s) passed lint.`));
  }
}

function printViolations(fileName: string, violations: LintViolation[]): void {
  console.error(chalk.red(`\n✗ ${fileName}:`));
  for (const v of violations) {
    const tag = v.severity === 'warn'
      ? chalk.yellow('  warn ')
      : chalk.red('  error');
    console.error(`${tag}  [${v.rule}] ${v.message}`);
    console.error(chalk.gray(`         hint: ${v.hint}`));
  }
}
