import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { MigraguardConfig } from './config.js';
import { resolveFromConfig } from './config.js';
import { parseFileName, compareSortKeys } from './naming.js';
import type { ParsedFileName } from './naming.js';

export interface MigrationFile {
  fileName: string;
  filePath: string;
  sourceDir: string;
  parsed: ParsedFileName;
}

async function scanOneDir(
  dirPath: string,
  sourceDir: string,
  naming: MigraguardConfig['naming'],
): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const files: MigrationFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.sql')) continue;
    const parsed = parseFileName(entry, naming);
    if (!parsed) continue;
    files.push({
      fileName: entry,
      filePath: resolve(dirPath, entry),
      sourceDir,
      parsed,
    });
  }
  return files;
}

export async function scanMigrations(config: MigraguardConfig): Promise<MigrationFile[]> {
  const allFiles: MigrationFile[] = [];

  for (const dir of config.migrationsDirs) {
    const absDir = resolveFromConfig(config, dir);
    const files = await scanOneDir(absDir, dir, config.naming);
    allFiles.push(...files);
  }

  allFiles.sort((a, b) => compareSortKeys(a.parsed.sortKey, b.parsed.sortKey));
  return allFiles;
}
