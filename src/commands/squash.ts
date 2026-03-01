import { readFile, writeFile, unlink } from 'node:fs/promises';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { loadMetadata, saveMetadata, addEntry, isDagMode } from '../metadata.js';
import { checksumString } from '../checksum.js';
import type { MigrationFile } from '../scanner.js';
import { buildDependencyGraph } from '../deps.js';

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

  if (isDagMode(metadata)) {
    await validateDagSquash(config, newFiles);
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

async function validateDagSquash(
  config: MigraguardConfig,
  newFiles: MigrationFile[],
): Promise<void> {
  const graph = await buildDependencyGraph(config);
  const newFileSet = new Set(newFiles.map((f) => f.fileName));

  const neighbors = new Map<string, Set<string>>();
  for (const f of newFiles) {
    neighbors.set(f.fileName, new Set());
  }
  for (const edge of graph.edges) {
    if (newFileSet.has(edge.from) && newFileSet.has(edge.to)) {
      neighbors.get(edge.from)!.add(edge.to);
      neighbors.get(edge.to)!.add(edge.from);
    }
  }

  const visited = new Set<string>();
  function walk(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    for (const neighbor of neighbors.get(file) ?? []) {
      walk(neighbor);
    }
  }

  walk(newFiles[0].fileName);

  const unreachable = newFiles.filter((f) => !visited.has(f.fileName));
  if (unreachable.length > 0) {
    const names = unreachable.map((f) => f.fileName);
    throw new Error(
      `Cannot squash: new files are in independent branches.\n` +
      `  Unreachable from "${newFiles[0].fileName}": ${names.join(', ')}\n` +
      `  In DAG mode, only files within the same dependency chain can be squashed.`,
    );
  }
}
