import { readFile, writeFile, unlink } from 'node:fs/promises';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { loadMetadata, saveMetadata, addEntry } from '../metadata.js';
import { checksumString } from '../checksum.js';
import type { MigrationFile } from '../scanner.js';

function buildSquashedFileName(newFiles: MigrationFile[]): string {
  const latestTimestamp = newFiles[newFiles.length - 1].parsed.timestamp;
  const descriptions = newFiles.map((f) => f.parsed.description);
  const combined = descriptions.join('_and_');
  const prefix = newFiles[0].parsed.prefix;
  const ext = '.sql';

  if (prefix) {
    return `${prefix}_${latestTimestamp}__${combined}${ext}`;
  }
  return `${latestTimestamp}__${combined}${ext}`;
}

export async function commandSquash(config: MigraguardConfig): Promise<void> {
  const metadata = await loadMetadata(config);
  const files = await scanMigrations(config);
  const metadataFileSet = new Set(metadata.migrations.map((m) => m.file));

  const newFiles = files.filter((f) => !metadataFileSet.has(f.fileName));

  if (newFiles.length === 0) {
    console.log(chalk.yellow('No new migration files to squash.'));
    return;
  }

  if (newFiles.length === 1) {
    console.log(chalk.yellow('Only one new file found. Nothing to squash.'));
    return;
  }

  const contents: string[] = [];
  for (const f of newFiles) {
    const content = await readFile(f.filePath, 'utf-8');
    contents.push(`-- Source: ${f.fileName}\n${content}`);
  }
  const merged = contents.join('\n\n');

  const squashedName = buildSquashedFileName(newFiles);
  const primaryDir = config.migrationsDirs[0];
  const migrationsDir = resolveFromConfig(config, primaryDir);
  const squashedPath = `${migrationsDir}/${squashedName}`;

  await writeFile(squashedPath, merged, 'utf-8');

  for (const f of newFiles) {
    await unlink(f.filePath);
  }

  const checksum = checksumString(merged);
  const updatedMetadata = addEntry(metadata, { file: squashedName, checksum });
  await saveMetadata(config, updatedMetadata);

  console.log(chalk.green(`Squashed ${newFiles.length} files into: ${primaryDir}/${squashedName}`));
  for (const f of newFiles) {
    console.log(chalk.gray(`  removed: ${f.fileName}`));
  }
}
