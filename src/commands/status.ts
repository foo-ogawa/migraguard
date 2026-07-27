import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { checksumFile } from '../checksum.js';
import { createDb, safeGetAllRecords } from '../db.js';
import type { MigrationRecord } from '../db.js';
import { loadMetadata } from '../metadata.js';
import { deriveAllGroupStates } from '../group-state.js';
import type { GroupState } from '../group-state.js';

export type FileStatus = 'applied' | 'pending' | 'failed' | 'skipped' | 'changed';

export interface StatusEntry {
  fileName: string;
  status: FileStatus;
  checksum: string;
  appliedAt?: Date;
}

export interface StatusResult {
  entries: StatusEntry[];
  groups: GroupState[];
}

function getLatestRecord(records: MigrationRecord[]): MigrationRecord | undefined {
  if (records.length === 0) return undefined;
  return records.reduce((latest, r) =>
    r.appliedAt > latest.appliedAt ? r : latest,
  );
}

export async function commandStatus(config: MigraguardConfig): Promise<StatusResult> {
  const db = createDb(config);
  const entries: StatusEntry[] = [];
  let groups: GroupState[];

  try {
    await db.connect();

    const files = await scanMigrations(config);
    const allRecords = await safeGetAllRecords(db);

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
    groups = deriveAllGroupStates(allRecords);
  } finally {
    await db.close();
  }

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

  if (groups.length > 0) {
    console.log(chalk.bold('\nMigration Groups:\n'));
    for (const gs of groups) {
      console.log(`  ${chalk.bold(gs.groupName)}`);
      console.log(`    state: ${formatGroupState(gs.state)}`);
      for (const phase of ['expand', 'backfill', 'switch', 'contract'] as const) {
        const pr = gs.phases[phase];
        if (pr) {
          console.log(`    ${phase.padEnd(10)} ${pr.status} (${pr.appliedAt.toISOString()})`);
        } else {
          console.log(`    ${phase.padEnd(10)} not_applied`);
        }
      }
      console.log();
    }
  }

  const metadata = await loadMetadata(config);
  if (metadata.baselines && metadata.baselines.length > 0) {
    const totalBaselined = metadata.baselines.reduce((n, b) => n + b.includes.length, 0);
    console.log(chalk.bold(`\n  Baselined (${totalBaselined} files in schema.sql):`));
    for (const baseline of metadata.baselines) {
      for (const inc of baseline.includes) {
        console.log(`    ${chalk.magenta('◆')} ${inc.file}  ${chalk.gray(`(baseline ${baseline.date.substring(0, 10)})`)}`);
      }
    }
  }

  return { entries, groups };
}

function formatGroupState(state: string): string {
  switch (state) {
    case 'contract_completed': return chalk.green(state);
    case 'backfill_failed': return chalk.red(state);
    case 'backfill_running': return chalk.yellow(state);
    default: return chalk.cyan(state);
  }
}
