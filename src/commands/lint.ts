import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import type { MigraguardConfig, RuleSeverity } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { loadMetadata, resolveEditability } from '../metadata.js';
import type { Phase } from '../naming.js';
import { ALL_RULES, runRules } from '../rules/index.js';
import type { LintRule, LintViolation, RawViolation } from '../rules/index.js';
import { ALL_GENERIC_RULES, runGenericRules } from '../generic/rules/index.js';
import type { GenericDialect } from '../generic/rules/index.js';
import { writeJson } from '../output.js';
import type { OutputFormat } from '../output.js';

export interface LintOptions {
  format?: OutputFormat;
}

export interface LintFileViolation extends LintViolation {
  file: string;
}

export interface LintResult {
  ok: boolean;
  /** Files checked: those not yet recorded in metadata.json and the editable ones. */
  filesLinted: number;
  /** Recorded files that can no longer change; their content was judged when they were added. */
  filesSkipped: number;
  errors: number;
  warnings: number;
  violations: LintFileViolation[];
}

interface LintEngine {
  ruleCount: number;
  run(sql: string, phase: Phase | undefined): Promise<RawViolation[]>;
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

function rulesForPhase<R extends { applicablePhases?: Phase[] }>(rules: R[], phase: Phase | undefined): R[] {
  return rules.filter((r) => {
    if (!r.applicablePhases) return true;
    if (!phase) return false;
    return r.applicablePhases.includes(phase);
  });
}

async function createEngine(config: MigraguardConfig): Promise<LintEngine> {
  if (config.dialect === 'postgresql') {
    const rules = [...ALL_RULES, ...await loadCustomRules(config)]
      .filter((r) => getSeverity(config, r.id) !== 'off');
    return {
      ruleCount: rules.length,
      run: (sql, phase) => runRules(sql, rulesForPhase(rules, phase)),
    };
  }
  const dialect = config.dialect as GenericDialect;
  const rules = ALL_GENERIC_RULES.filter((r) => getSeverity(config, r.id) !== 'off');
  return {
    ruleCount: rules.length,
    run: (sql, phase) => runGenericRules(sql, rulesForPhase(rules, phase), dialect),
  };
}

export async function commandLint(config: MigraguardConfig, options?: LintOptions): Promise<LintResult> {
  const text = (options?.format ?? 'text') === 'text';

  const files = await scanMigrations(config);
  const metadata = await loadMetadata(config);
  const { frozen } = await resolveEditability(config, metadata, files);
  const targets = files.filter((f) => !frozen.has(f.fileName));

  const result: LintResult = {
    ok: true,
    filesLinted: targets.length,
    filesSkipped: files.length - targets.length,
    errors: 0,
    warnings: 0,
    violations: [],
  };

  const engine = files.length > 0 ? await createEngine(config) : undefined;

  if (!engine) {
    if (text) console.log(chalk.yellow('No migration files to lint.'));
  } else if (engine.ruleCount === 0) {
    if (text) console.log(chalk.yellow('All lint rules are disabled.'));
  } else {
    for (const f of targets) {
      const sql = await readFile(f.filePath, 'utf-8');
      const raw = await engine.run(sql, f.phase);
      if (raw.length === 0) continue;

      const violations: LintFileViolation[] = raw.map((v) => ({
        file: f.fileName,
        ...v,
        severity: getSeverity(config, v.rule) === 'warn' ? 'warn' : 'error',
      }));
      result.violations.push(...violations);
      if (text) printViolations(f.fileName, violations);
    }

    result.errors = result.violations.filter((v) => v.severity === 'error').length;
    result.warnings = result.violations.filter((v) => v.severity === 'warn').length;
    result.ok = result.errors === 0;
    if (text) printSummary(result);
  }

  if (!text) writeJson(result);
  return result;
}

function printSummary(result: LintResult): void {
  const { errors, warnings, filesLinted, filesSkipped } = result;
  const skipped = filesSkipped > 0
    ? ` (${filesSkipped} recorded file(s) that can no longer change were not linted)`
    : '';
  if (errors > 0 || warnings > 0) {
    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} error(s)`);
    if (warnings > 0) parts.push(`${warnings} warning(s)`);
    const summary = parts.join(', ');
    if (errors > 0) {
      console.error(chalk.red(`\nLint failed: ${summary}.${skipped}`));
    } else {
      console.log(chalk.yellow(`\nLint: ${summary}.${skipped}`));
    }
  } else {
    console.log(chalk.green(`✓ ${filesLinted} file(s) passed lint.${skipped}`));
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
