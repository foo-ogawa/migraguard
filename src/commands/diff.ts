import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { diffLines } from 'diff';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { dumpSchema } from '../dumper.js';

export interface DiffResult {
  identical: boolean;
  diff: string;
}

export function formatSchemaDiff(saved: string, current: string): string {
  const changes = diffLines(saved, current);
  const output: string[] = [];

  for (const part of changes) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added) {
      for (const line of lines) {
        output.push(chalk.green(`+ ${line}`));
      }
    } else if (part.removed) {
      for (const line of lines) {
        output.push(chalk.red(`- ${line}`));
      }
    }
  }

  return output.join('\n');
}

export async function commandDiff(config: MigraguardConfig): Promise<DiffResult> {
  const schemaPath = resolveFromConfig(config, config.schemaFile);

  if (!existsSync(schemaPath)) {
    throw new Error(
      `Schema file not found: ${config.schemaFile}. Run "migraguard dump" first.`,
    );
  }

  const savedSchema = await readFile(schemaPath, 'utf-8');
  const currentSchema = await dumpSchema(config);

  if (savedSchema === currentSchema) {
    console.log(chalk.green('✓ Schema is in sync. No drift detected.'));
    return { identical: true, diff: '' };
  }

  const diff = formatSchemaDiff(savedSchema, currentSchema);
  console.error(chalk.yellow('✗ Schema drift detected:\n'));
  console.error(diff);

  return { identical: false, diff };
}
