import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { MigraguardConfig } from './config.js';
import { resolveFromConfig } from './config.js';

export interface MigrationEntry {
  file: string;
  checksum: string;
}

export interface MetadataJson {
  model?: 'dag';
  modelSince?: string;
  migrations: MigrationEntry[];
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

export function isDagMode(metadata: MetadataJson): boolean {
  return metadata.model === 'dag';
}

export function isPreModelSince(metadata: MetadataJson, fileName: string): boolean {
  if (!metadata.model || !metadata.modelSince) return true;
  return fileName < metadata.modelSince;
}

function isMetadataJson(data: unknown): data is MetadataJson {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['migrations'])) return false;
  if ('model' in obj && obj['model'] !== undefined && obj['model'] !== 'dag') return false;
  if ('modelSince' in obj && obj['modelSince'] !== undefined && typeof obj['modelSince'] !== 'string') return false;
  return obj['migrations'].every(
    (m: unknown) =>
      typeof m === 'object' &&
      m !== null &&
      typeof (m as Record<string, unknown>)['file'] === 'string' &&
      typeof (m as Record<string, unknown>)['checksum'] === 'string',
  );
}
