import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { checksumFile } from '../checksum.js';
import { MigraguardDb } from '../db.js';
import type { MigrationRecord } from '../db.js';

export type FileStatus = 'applied' | 'pending' | 'failed' | 'skipped' | 'changed';

export interface StatusEntry {
  fileName: string;
  status: FileStatus;
  checksum: string;
  appliedAt?: Date;
}

export interface StatusResult {
  entries: StatusEntry[];
}

function getLatestRecord(records: MigrationRecord[]): MigrationRecord | undefined {
  if (records.length === 0) return undefined;
  return records.reduce((latest, r) =>
    r.appliedAt > latest.appliedAt ? r : latest,
  );
}

export async function commandStatus(config: MigraguardConfig): Promise<StatusResult> {
  const db = new MigraguardDb(config);
  const entries: StatusEntry[] = [];

  try {
    await db.connect();
    await db.ensureTable();

    const files = await scanMigrations(config);
    const allRecords = await db.getAllRecords();

    const recordsByFile = new Map<string, MigrationRecord[]>();
    for (const r of allRecords) {
      const list = recordsByFile.get(r.fileName) ?? [];
      list.push(r);
      recordsByFile.set(r.fileName, list);
    }

    for (const file of files) {
      const fileRecords = recordsByFile.get(file.fileName) ?? [];
      const latestRecord = getLatestRecord(fileRecords);
      const currentChecksum = await checksumFile(file.filePath);

      if (!latestRecord) {
        entries.push({ fileName: file.fileName, status: 'pending', checksum: currentChecksum });
      } else if (latestRecord.status === 'failed') {
        entries.push({
          fileName: file.fileName,
          status: 'failed',
          checksum: currentChecksum,
          appliedAt: latestRecord.appliedAt,
        });
      } else if (latestRecord.status === 'skipped') {
        entries.push({
          fileName: file.fileName,
          status: 'skipped',
          checksum: currentChecksum,
          appliedAt: latestRecord.appliedAt,
        });
      } else if (latestRecord.checksum !== currentChecksum) {
        entries.push({
          fileName: file.fileName,
          status: 'changed',
          checksum: currentChecksum,
          appliedAt: latestRecord.appliedAt,
        });
      } else {
        entries.push({
          fileName: file.fileName,
          status: 'applied',
          checksum: currentChecksum,
          appliedAt: latestRecord.appliedAt,
        });
      }
    }
  } finally {
    await db.close();
  }

  // Display
  const statusColors: Record<FileStatus, (s: string) => string> = {
    applied: chalk.green,
    pending: chalk.cyan,
    failed: chalk.red,
    skipped: chalk.gray,
    changed: chalk.yellow,
  };

  const statusLabels: Record<FileStatus, string> = {
    applied: '✓ applied',
    pending: '○ pending',
    failed: '✗ failed',
    skipped: '− skipped',
    changed: '△ changed',
  };

  console.log(chalk.bold('Migration status:\n'));
  for (const entry of entries) {
    const colorFn = statusColors[entry.status];
    const label = statusLabels[entry.status];
    console.log(`  ${colorFn(label.padEnd(12))} ${entry.fileName}`);
  }

  const counts = {
    applied: entries.filter((e) => e.status === 'applied').length,
    pending: entries.filter((e) => e.status === 'pending').length,
    failed: entries.filter((e) => e.status === 'failed').length,
    skipped: entries.filter((e) => e.status === 'skipped').length,
    changed: entries.filter((e) => e.status === 'changed').length,
  };
  console.log(`\n  Total: ${entries.length} | Applied: ${counts.applied} | Pending: ${counts.pending} | Failed: ${counts.failed} | Skipped: ${counts.skipped} | Changed: ${counts.changed}`);

  return { entries };
}
