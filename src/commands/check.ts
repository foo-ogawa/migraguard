import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { loadMetadata, isDagMode, isPreModelSince } from '../metadata.js';
import { checksumFile } from '../checksum.js';
import { buildDependencyGraph, findLeafNodes } from '../deps.js';

export interface CheckResult {
  ok: boolean;
  errors: string[];
}

export async function commandCheck(config: MigraguardConfig): Promise<CheckResult> {
  const errors: string[] = [];
  const metadata = await loadMetadata(config);
  const files = await scanMigrations(config);
  const dag = isDagMode(metadata);

  const metadataMap = new Map(metadata.migrations.map((m) => [m.file, m.checksum]));

  const recordedFiles = files.filter((f) => metadataMap.has(f.fileName));
  const newFiles = files.filter((f) => !metadataMap.has(f.fileName));

  let editableSet: Set<string>;

  if (dag) {
    const graph = await buildDependencyGraph(config);
    const leaves = findLeafNodes(graph);
    editableSet = new Set(
      leaves.filter((f) => !isPreModelSince(metadata, f)),
    );
  } else {
    editableSet = new Set<string>();
    if (files.length > 0) {
      editableSet.add(files[files.length - 1].fileName);
    }
  }

  // 1. Multiple new files check (linear mode only)
  if (!dag && newFiles.length > 1) {
    errors.push(
      `Found ${newFiles.length} new files not recorded in metadata.json. ` +
      `Run "migraguard squash" to merge them into a single file before committing.`,
    );
    for (const f of newFiles) {
      errors.push(`  new: ${f.fileName}`);
    }
  }

  // 2. Mid-sequence insertion (linear mode only)
  if (!dag && newFiles.length > 0 && recordedFiles.length > 0) {
    const lastRecordedSortKey = recordedFiles[recordedFiles.length - 1].parsed.sortKey;
    for (const nf of newFiles) {
      if (nf.parsed.sortKey < lastRecordedSortKey) {
        errors.push(
          `New file "${nf.fileName}" has a timestamp before the last recorded file. ` +
          `Mid-sequence insertion is not allowed.`,
        );
      }
    }
  }

  // 3. Checksum verification — editable files may change, others must not
  for (const f of recordedFiles) {
    const expectedChecksum = metadataMap.get(f.fileName);
    if (!expectedChecksum) continue;

    const actualChecksum = await checksumFile(f.filePath);
    if (actualChecksum !== expectedChecksum) {
      if (editableSet.has(f.fileName)) {
        continue;
      }
      errors.push(
        `Checksum mismatch for "${f.fileName}": ` +
        `expected ${expectedChecksum.slice(0, 12)}..., got ${actualChecksum.slice(0, 12)}...`,
      );
    }
  }

  // 4. Missing files
  const fileNames = new Set(files.map((f) => f.fileName));
  for (const entry of metadata.migrations) {
    if (!fileNames.has(entry.file)) {
      errors.push(`File recorded in metadata.json but missing from disk: "${entry.file}"`);
    }
  }

  const ok = errors.length === 0;

  if (ok) {
    console.log(chalk.green('✓ All checks passed.'));
  } else {
    console.error(chalk.red('✗ Check failed:'));
    for (const err of errors) {
      console.error(chalk.red(`  ${err}`));
    }
  }

  return { ok, errors };
}
