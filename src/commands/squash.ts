import { readFile, writeFile, unlink } from 'node:fs/promises';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { loadMetadata, saveMetadata, addEntry, isDagMode } from '../metadata.js';
import { checksumString } from '../checksum.js';
import { compareSortKeys } from '../naming.js';
import type { MigrationFile } from '../scanner.js';
import type { MetadataJson } from '../metadata.js';
import { buildDependencyGraph } from '../deps.js';
import type { DependencyGraph } from '../deps.js';

function buildSquashedFileName(group: MigrationFile[]): string {
  const latestTimestamp = group[group.length - 1].parsed.timestamp;
  const descriptions = group.map((f) => f.parsed.description);
  const combined = descriptions.join('_and_');
  const prefix = group[0].parsed.prefix;
  const ext = '.sql';

  if (prefix) {
    return `${prefix}_${latestTimestamp}__${combined}${ext}`;
  }
  return `${latestTimestamp}__${combined}${ext}`;
}

async function squashGroup(
  config: MigraguardConfig,
  group: MigrationFile[],
  metadata: MetadataJson,
): Promise<MetadataJson> {
  const sorted = [...group].sort((a, b) => compareSortKeys(a.parsed.sortKey, b.parsed.sortKey));

  const contents: string[] = [];
  for (const f of sorted) {
    const content = await readFile(f.filePath, 'utf-8');
    contents.push(`-- Source: ${f.fileName}\n${content}`);
  }
  const merged = contents.join('\n\n');

  const squashedName = buildSquashedFileName(sorted);
  const primaryDir = config.migrationsDirs[0];
  const migrationsDir = resolveFromConfig(config, primaryDir);
  const squashedPath = `${migrationsDir}/${squashedName}`;

  await writeFile(squashedPath, merged, 'utf-8');

  for (const f of sorted) {
    await unlink(f.filePath);
  }

  const checksum = checksumString(merged);
  const updated = addEntry(metadata, { file: squashedName, checksum });

  console.log(chalk.green(`Squashed ${sorted.length} files into: ${primaryDir}/${squashedName}`));
  for (const f of sorted) {
    console.log(chalk.gray(`  removed: ${f.fileName}`));
  }

  return updated;
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

  if (isDagMode(metadata)) {
    await dagSquash(config, newFiles, metadata);
  } else {
    if (newFiles.length === 1) {
      console.log(chalk.yellow('Only one new file found. Nothing to squash.'));
      return;
    }
    const updated = await squashGroup(config, newFiles, metadata);
    await saveMetadata(config, updated);
  }
}

async function dagSquash(
  config: MigraguardConfig,
  newFiles: MigrationFile[],
  metadata: MetadataJson,
): Promise<void> {
  const graph = await buildDependencyGraph(config);
  const groups = findConnectedComponents(newFiles, graph);

  const squashable = groups.filter((g) => g.length >= 2);
  const standalone = groups.filter((g) => g.length === 1);

  if (squashable.length === 0) {
    if (standalone.length > 0) {
      console.log(chalk.yellow(
        `${standalone.length} independent new file(s) — nothing to squash.`,
      ));
    } else {
      console.log(chalk.yellow('No new migration files to squash.'));
    }
    return;
  }

  let currentMeta = metadata;
  for (const group of squashable) {
    currentMeta = await squashGroup(config, group, currentMeta);
  }
  await saveMetadata(config, currentMeta);

  if (standalone.length > 0) {
    console.log(chalk.cyan(
      `\n${standalone.length} independent file(s) left as-is (no squash needed):`,
    ));
    for (const g of standalone) {
      console.log(chalk.gray(`  ${g[0].fileName}`));
    }
  }
}

function findConnectedComponents(
  newFiles: MigrationFile[],
  graph: DependencyGraph,
): MigrationFile[][] {
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
  const components: MigrationFile[][] = [];
  const fileMap = new Map(newFiles.map((f) => [f.fileName, f]));

  for (const f of newFiles) {
    if (visited.has(f.fileName)) continue;

    const component: MigrationFile[] = [];
    const queue = [f.fileName];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const mf = fileMap.get(current);
      if (mf) component.push(mf);
      for (const neighbor of neighbors.get(current) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    component.sort((a, b) => compareSortKeys(a.parsed.sortKey, b.parsed.sortKey));
    components.push(component);
  }

  return components;
}
