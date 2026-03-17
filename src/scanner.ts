import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { MigraguardConfig } from './config.js';
import { resolveFromConfig } from './config.js';
import {
  parseFileName,
  parseGroupDirName,
  parsePhaseFileName,
  compareSortKeys,
} from './naming.js';
import type { ParsedFileName, Phase, ParsedPhaseFile } from './naming.js';

export type MigrationClass = 'safe' | 'expand_contract';

export interface MigrationFile {
  fileName: string;
  filePath: string;
  sourceDir: string;
  parsed: ParsedFileName;
  migrationClass: MigrationClass;
  phase?: Phase;
  groupName?: string;
  phaseFiles?: ParsedPhaseFile[];
}

async function scanPhaseFiles(groupDirPath: string): Promise<ParsedPhaseFile[]> {
  let entries: string[];
  try {
    entries = await readdir(groupDirPath);
  } catch {
    return [];
  }

  const phases: ParsedPhaseFile[] = [];
  for (const entry of entries) {
    const parsed = parsePhaseFileName(entry);
    if (parsed) phases.push(parsed);
  }
  phases.sort((a, b) => a.order - b.order);
  return phases;
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
    const entryPath = resolve(dirPath, entry);

    if (entry.endsWith('.sql')) {
      const parsed = parseFileName(entry, naming);
      if (!parsed) continue;
      files.push({
        fileName: entry,
        filePath: entryPath,
        sourceDir,
        parsed,
        migrationClass: 'safe',
      });
      continue;
    }

    const entryStat = await stat(entryPath).catch(() => null);
    if (!entryStat?.isDirectory()) continue;

    const groupParsed = parseGroupDirName(entry, naming);
    if (!groupParsed) continue;

    const phaseFiles = await scanPhaseFiles(entryPath);
    if (phaseFiles.length === 0) continue;

    for (const pf of phaseFiles) {
      const phaseFileName = `${entry}/${pf.fileName}`;
      const phaseFilePath = resolve(entryPath, pf.fileName);
      files.push({
        fileName: phaseFileName,
        filePath: phaseFilePath,
        sourceDir,
        parsed: { ...groupParsed, fullName: phaseFileName },
        migrationClass: 'expand_contract',
        phase: pf.phase,
        groupName: entry,
        phaseFiles,
      });
    }
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
