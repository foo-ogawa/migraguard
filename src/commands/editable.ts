import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { loadMetadata, isDagMode, isPreModelSince } from '../metadata.js';
import { MigraguardDb } from '../db.js';
import type { MigrationRecord } from '../db.js';
import { buildDependencyGraph, findLeafNodes } from '../deps.js';

export interface EditableEntry {
  fileName: string;
  reason: 'latest' | 'leaf' | 'new' | 'failed-retryable';
}

export interface EditableResult {
  editableFiles: string[];
  entries: EditableEntry[];
}

function getLatestRecord(records: MigrationRecord[]): MigrationRecord | undefined {
  if (records.length === 0) return undefined;
  return records.reduce((latest, r) =>
    r.appliedAt > latest.appliedAt ? r : latest,
  );
}

export async function commandEditable(config: MigraguardConfig): Promise<EditableResult> {
  const files = await scanMigrations(config);

  if (files.length === 0) {
    console.log(chalk.yellow('No migration files found.'));
    return { editableFiles: [], entries: [] };
  }

  const metadata = await loadMetadata(config);
  const dag = isDagMode(metadata);
  const metadataFileSet = new Set(metadata.migrations.map((m) => m.file));
  const newFiles = files.filter((f) => !metadataFileSet.has(f.fileName));

  const entries: EditableEntry[] = [];
  const editableSet = new Set<string>();

  if (dag) {
    const graph = await buildDependencyGraph(config);
    const leaves = findLeafNodes(graph);
    for (const leaf of leaves) {
      if (isPreModelSince(metadata, leaf)) continue;
      if (!editableSet.has(leaf)) {
        editableSet.add(leaf);
        entries.push({ fileName: leaf, reason: 'leaf' });
      }
    }
  } else {
    const latestFile = files[files.length - 1];
    editableSet.add(latestFile.fileName);
    entries.push({ fileName: latestFile.fileName, reason: 'latest' });
  }

  for (const f of newFiles) {
    if (!editableSet.has(f.fileName)) {
      editableSet.add(f.fileName);
      entries.push({ fileName: f.fileName, reason: 'new' });
    }
  }

  let dbConnected = false;
  try {
    const db = new MigraguardDb(config);
    await db.connect();
    dbConnected = true;

    try {
      await db.ensureTable();
      const allRecords = await db.getAllRecords();

      const recordsByFile = new Map<string, MigrationRecord[]>();
      for (const r of allRecords) {
        const list = recordsByFile.get(r.fileName) ?? [];
        list.push(r);
        recordsByFile.set(r.fileName, list);
      }

      for (const file of files) {
        if (editableSet.has(file.fileName)) continue;

        const fileRecords = recordsByFile.get(file.fileName) ?? [];
        const latestRecord = getLatestRecord(fileRecords);
        if (latestRecord?.status === 'failed') {
          editableSet.add(file.fileName);
          entries.push({ fileName: file.fileName, reason: 'failed-retryable' });
        }
      }
    } finally {
      await db.close();
    }
  } catch {
    // DB connection failure → file-based only
  }

  const editableFiles = files
    .filter((f) => editableSet.has(f.fileName))
    .map((f) => f.fileName);

  const reasonLabels: Record<EditableEntry['reason'], string> = {
    'latest': chalk.green(' (latest)'),
    'leaf': chalk.green(' (leaf)'),
    'new': chalk.cyan(' (new)'),
    'failed-retryable': chalk.red(' (failed — retryable)'),
  };

  console.log(chalk.bold('Editable migration files:'));
  for (const entry of entries) {
    if (!editableFiles.includes(entry.fileName)) continue;
    console.log(`  ${entry.fileName}${reasonLabels[entry.reason]}`);
  }

  if (dbConnected) {
    console.log(chalk.gray('\n  (DB connected — showing failed-retryable files)'));
  } else {
    console.log(chalk.gray('\n  (DB not connected — file-based only)'));
  }

  return { editableFiles, entries };
}
