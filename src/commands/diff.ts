import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { diffLines } from 'diff';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { dumpSchema } from '../dumper.js';
import { writeJson } from '../output.js';
import type { OutputFormat } from '../output.js';

export interface DiffResult {
  identical: boolean;
  /** Changed lines of schema.sql against the DB: `+ line` added in the DB, `- line` missing from it. */
  diff: string;
}

export interface DiffOptions {
  format?: OutputFormat;
}

export function formatSchemaDiff(saved: string, current: string): string {
  const changes = diffLines(saved, current);
  const output: string[] = [];

  for (const part of changes) {
    if (!part.added && !part.removed) continue;
    const mark = part.added ? '+' : '-';
    for (const line of part.value.replace(/\n$/, '').split('\n')) {
      output.push(`${mark} ${line}`);
    }
  }

  return output.join('\n');
}

export async function commandDiff(config: MigraguardConfig, options?: DiffOptions): Promise<DiffResult> {
  const text = (options?.format ?? 'text') === 'text';
  const schemaPath = resolveFromConfig(config, config.schemaFile);

  if (!existsSync(schemaPath)) {
    throw new Error(
      `Schema file not found: ${config.schemaFile}. Run "migraguard dump" first.`,
    );
  }

  const savedSchema = await readFile(schemaPath, 'utf-8');
  const currentSchema = await dumpSchema(config);
  const diff = formatSchemaDiff(savedSchema, currentSchema);
  const result: DiffResult = { identical: savedSchema === currentSchema, diff };

  if (!text) {
    writeJson(result);
  } else if (result.identical) {
    console.log(chalk.green('✓ Schema is in sync. No drift detected.'));
  } else {
    console.error(chalk.yellow('✗ Schema drift detected:\n'));
    for (const line of diff.split('\n')) {
      console.error(line.startsWith('+') ? chalk.green(line) : chalk.red(line));
    }
  }

  return result;
}
