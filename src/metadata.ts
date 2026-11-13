import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { MigraguardConfig } from './config.js';
import { resolveFromConfig } from './config.js';
import type { MigrationClass, MigrationFile } from './scanner.js';
import { buildDependencyGraphFromFiles, findLeafNodes } from './deps.js';
import type { DependencyGraph } from './deps.js';

export interface MigrationEntry {
  file: string;
  checksum: string;
  migrationClass?: MigrationClass;
  groupName?: string;
}

export interface BaselineInclude {
  file: string;
  checksum: string;
}

export interface BaselineEntry {
  date: string;
  includes: BaselineInclude[];
}

export interface MetadataJson {
  model?: 'dag';
  modelSince?: string;
  migrations: MigrationEntry[];
  baselines?: BaselineEntry[];
}

export function metadataPath(config: MigraguardConfig): string {
  return resolveFromConfig(config, config.metadataFile);
}

export async function loadMetadata(config: MigraguardConfig): Promise<MetadataJson> {
  const path = metadataPath(config);
  if (!existsSync(path)) {
    return { migrations: [] };
  }

  const content = await readFile(path, 'utf-8');
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in metadata file: ${path}`);
  }

  if (!isMetadataJson(data)) {
    throw new Error(`Invalid metadata format in: ${path}`);
  }

  return data;
}

export async function saveMetadata(config: MigraguardConfig, metadata: MetadataJson): Promise<void> {
  const path = metadataPath(config);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const content = JSON.stringify(metadata, null, 2) + '\n';
  await writeFile(path, content, 'utf-8');
}

export function findEntry(metadata: MetadataJson, fileName: string): MigrationEntry | undefined {
  return metadata.migrations.find((m) => m.file === fileName);
}

export function addEntry(metadata: MetadataJson, entry: MigrationEntry): MetadataJson {
  return {
    ...metadata,
    migrations: [...metadata.migrations, entry],
  };
}

export function removeEntry(metadata: MetadataJson, fileName: string): MetadataJson {
  return {
    ...metadata,
    migrations: metadata.migrations.filter((m) => m.file !== fileName),
  };
}

export function updateEntry(metadata: MetadataJson, fileName: string, checksum: string): MetadataJson {
  return {
    ...metadata,
    migrations: metadata.migrations.map((m) =>
      m.file === fileName ? { ...m, checksum } : m,
    ),
  };
}

export function isDagMode(metadata: MetadataJson, config?: MigraguardConfig): boolean {
  return config?.model === 'dag' || metadata.model === 'dag';
}

export interface Editability {
  /** Files forward-only allows to change: the tail file (linear) or the leaf nodes (DAG). */
  editable: Set<string>;
  /** Files recorded in metadata.json that are not editable — their content is fixed. */
  frozen: Set<string>;
}

/**
 * Classifies migration files by whether they may still change.
 *
 * `graph` is the dependency graph in DAG mode and `null` in linear mode.
 * Files whose names sort before `modelSince` are settled — the linear era the
 * first DAG file builds on, or migrations recorded by `squash --record-only` —
 * so they are never the editable tail file or leaf.
 */
export function classifyEditability(
  files: MigrationFile[],
  metadata: MetadataJson,
  graph: DependencyGraph | null,
): Editability {
  const { modelSince } = metadata;
  const candidates = graph
    ? findLeafNodes(graph)
    : files.slice(-1).map((f) => f.fileName);
  const editable = new Set(
    candidates.filter((name) => !(modelSince && name < modelSince)),
  );

  const recorded = new Set(metadata.migrations.map((m) => m.file));
  const frozen = new Set(
    files.map((f) => f.fileName).filter((name) => recorded.has(name) && !editable.has(name)),
  );
  return { editable, frozen };
}

/**
 * Returns metadata whose `modelSince` sorts after every given file, so that
 * `classifyEditability` treats them as settled; a later `modelSince` is kept.
 * Appending a character to the greatest name yields a name after it and
 * before any file named with a later timestamp.
 */
export function settleFiles(metadata: MetadataJson, fileNames: string[]): MetadataJson {
  if (fileNames.length === 0) return metadata;
  const greatest = fileNames.reduce((a, b) => (b > a ? b : a));
  const boundary = `${greatest}~`;
  if (metadata.modelSince && metadata.modelSince >= boundary) return metadata;
  return { ...metadata, modelSince: boundary };
}

export async function resolveEditability(
  config: MigraguardConfig,
  metadata: MetadataJson,
  files: MigrationFile[],
): Promise<Editability> {
  const graph = isDagMode(metadata, config)
    ? await buildDependencyGraphFromFiles(files, config)
    : null;
  return classifyEditability(files, metadata, graph);
}

export function isBaselinedFile(metadata: MetadataJson, fileName: string): boolean {
  if (!metadata.baselines) return false;
  return metadata.baselines.some((b) =>
    b.includes.some((inc) => inc.file === fileName),
  );
}

function isMetadataJson(data: unknown): data is MetadataJson {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['migrations'])) return false;
  if ('model' in obj && obj['model'] !== undefined && obj['model'] !== 'dag') return false;
  if ('modelSince' in obj && obj['modelSince'] !== undefined && typeof obj['modelSince'] !== 'string') return false;
  if ('baselines' in obj && obj['baselines'] !== undefined && !Array.isArray(obj['baselines'])) return false;
  return obj['migrations'].every(
    (m: unknown) =>
      typeof m === 'object' &&
      m !== null &&
      typeof (m as Record<string, unknown>)['file'] === 'string' &&
      typeof (m as Record<string, unknown>)['checksum'] === 'string',
  );
}
