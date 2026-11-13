import { readFile, writeFile, unlink } from 'node:fs/promises';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { loadMetadata, saveMetadata, addEntry, isDagMode, settleFiles } from '../metadata.js';
import { checksumString, checksumFile } from '../checksum.js';
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

export interface SquashOptions {
  dryRun?: boolean;
  /**
   * Record every new file in metadata.json as-is, without merging any of them,
   * as released: `modelSince` moves past them so none stays editable.
   */
  recordOnly?: boolean;
}

/**
 * Records new migration files in metadata.json. Files that belong to one
 * release are merged into a single file first: all new files in the linear
 * model, each dependency-connected set of new files in the DAG model. A file
 * with nothing to merge with — and every expand/contract phase file, whose
 * phases must stay separate — is recorded as-is.
 */
export async function commandSquash(config: MigraguardConfig, options?: SquashOptions): Promise<void> {
  const metadata = await loadMetadata(config);
  const files = await scanMigrations(config);
  const metadataFileSet = new Set(metadata.migrations.map((m) => m.file));

  const newFiles = files.filter((f) => !metadataFileSet.has(f.fileName));

  if (newFiles.length === 0) {
    console.log(chalk.yellow('No new migration files to squash.'));
    return;
  }

  const groups = options?.recordOnly
    ? newFiles.map((f) => [f])
    : await releaseGroups(config, metadata, newFiles);

  const settled = options?.recordOnly
    ? settleFiles(metadata, newFiles.map((f) => f.fileName))
    : metadata;

  if (options?.dryRun) {
    for (const group of groups) {
      if (group.length >= 2) {
        console.log(chalk.cyan(`[dry-run] Would squash ${group.length} file(s) into: ${buildSquashedFileName(group)}`));
        for (const f of group) console.log(chalk.cyan(`  ${f.fileName}`));
      } else {
        console.log(chalk.cyan(`[dry-run] Would record: ${group[0].fileName}`));
      }
    }
    if (settled.modelSince !== metadata.modelSince) {
      console.log(chalk.cyan(`[dry-run] Would set modelSince: ${settled.modelSince}`));
    }
    return;
  }

  let currentMeta = settled;
  for (const group of groups) {
    currentMeta = group.length >= 2
      ? await squashGroup(config, group, currentMeta)
      : await recordFile(group[0], currentMeta);
  }
  if (settled.modelSince !== metadata.modelSince) {
    console.log(chalk.green(`Set modelSince: ${settled.modelSince}`));
  }
  await saveMetadata(config, currentMeta);
}

async function recordFile(file: MigrationFile, metadata: MetadataJson): Promise<MetadataJson> {
  const checksum = await checksumFile(file.filePath);
  console.log(chalk.green(`Recorded: ${file.fileName}`));
  return addEntry(metadata, { file: file.fileName, checksum });
}

async function releaseGroups(
  config: MigraguardConfig,
  metadata: MetadataJson,
  newFiles: MigrationFile[],
): Promise<MigrationFile[][]> {
  const phaseFiles = newFiles.filter((f) => f.migrationClass === 'expand_contract');
  const safeFiles = newFiles.filter((f) => f.migrationClass === 'safe');

  let safeGroups: MigrationFile[][];
  if (safeFiles.length === 0) {
    safeGroups = [];
  } else if (isDagMode(metadata, config)) {
    safeGroups = findConnectedComponents(safeFiles, await buildDependencyGraph(config));
  } else {
    safeGroups = [safeFiles];
  }
  return [...safeGroups, ...phaseFiles.map((f) => [f])];
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
