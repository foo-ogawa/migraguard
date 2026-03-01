import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { dumpSchema } from '../dumper.js';

export interface DiffResult {
  identical: boolean;
  diff: string;
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

  const savedLines = savedSchema.split('\n');
  const currentLines = currentSchema.split('\n');

  const diffLines: string[] = [];
  const maxLen = Math.max(savedLines.length, currentLines.length);

  for (let i = 0; i < maxLen; i++) {
    const saved = savedLines[i];
    const current = currentLines[i];
    if (saved === current) continue;
    if (saved !== undefined && current === undefined) {
      diffLines.push(chalk.red(`- ${saved}`));
    } else if (saved === undefined && current !== undefined) {
      diffLines.push(chalk.green(`+ ${current}`));
    } else if (saved !== current) {
      diffLines.push(chalk.red(`- ${saved}`));
      diffLines.push(chalk.green(`+ ${current}`));
    }
  }

  const diff = diffLines.join('\n');
  console.error(chalk.yellow('✗ Schema drift detected:\n'));
  console.error(diff);

  return { identical: false, diff };
}
