import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { createDb } from '../db.js';
import type { MigrationRecord } from '../db.js';

export interface ResolveOptions {
  dryRun?: boolean;
}

export async function commandResolve(config: MigraguardConfig, fileName: string, options?: ResolveOptions): Promise<void> {
  const db = createDb(config);

  try {
    await db.connect();
    await db.ensureTable();

    const records = await db.getRecordsForFile(fileName);
    if (records.length === 0) {
      throw new Error(`No records found for "${fileName}" in schema_migrations.`);
    }

    const latestRecord = records.reduce((latest: MigrationRecord, r: MigrationRecord) =>
      r.appliedAt > latest.appliedAt ? r : latest,
    );

    if (latestRecord.status !== 'failed') {
      throw new Error(
        `Cannot resolve "${fileName}": latest status is "${latestRecord.status}", expected "failed".`,
      );
    }

    if (options?.dryRun) {
      console.log(chalk.cyan(`[dry-run] Would resolve: "${fileName}" → mark as skipped`));
      console.log(chalk.cyan(`  Current status: ${latestRecord.status}, checksum: ${latestRecord.checksum}`));
      return;
    }

    await db.insertRecord(fileName, latestRecord.checksum, 'skipped');
    console.log(chalk.green(`✓ Resolved: "${fileName}" marked as skipped.`));
    console.log(chalk.gray(`  Ensure a subsequent forward migration covers the intended changes.`));
  } finally {
    await db.close();
  }
}
