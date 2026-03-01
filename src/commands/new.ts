import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { generateFileName } from '../naming.js';
import { scanMigrations } from '../scanner.js';

const TEMPLATE = `-- Migration: {description}
-- Created at: {timestamp}

`;

export async function commandNew(config: MigraguardConfig, name: string): Promise<void> {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Invalid migration name: "${name}". Use only alphanumeric characters and underscores.`);
  }

  const existingFiles = await scanMigrations(config);
  const existingParsed = existingFiles.map((f) => f.parsed);

  const now = new Date();
  const fileName = generateFileName(name, config.naming, { now, existingParsed });
  const primaryDir = config.migrationsDirs[0];
  const migrationsDir = resolveFromConfig(config, primaryDir);

  if (!existsSync(migrationsDir)) {
    await mkdir(migrationsDir, { recursive: true });
  }

  const filePath = `${migrationsDir}/${fileName}`;
  if (existsSync(filePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }

  const content = TEMPLATE
    .replace('{description}', name)
    .replace('{timestamp}', now.toISOString());

  await writeFile(filePath, content, 'utf-8');
  console.log(chalk.green(`Created: ${primaryDir}/${fileName}`));
}
