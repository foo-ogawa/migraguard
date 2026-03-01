import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { checksumFile } from '../checksum.js';
import { MigraguardDb } from '../db.js';
import type { MigrationRecord } from '../db.js';
import { executePsqlFile } from '../psql.js';
import { dumpSchema } from '../dumper.js';

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  failed: string | null;
  errors: string[];
}

function getLatestRecord(records: MigrationRecord[]): MigrationRecord | undefined {
  if (records.length === 0) return undefined;
  return records.reduce((latest, r) =>
    r.appliedAt > latest.appliedAt ? r : latest,
  );
}

function getPastChecksums(records: MigrationRecord[], latestRecord: MigrationRecord): Set<string> {
  const past = new Set<string>();
  for (const r of records) {
    if (r !== latestRecord) {
      past.add(r.checksum);
    }
  }
  return past;
}

export interface ApplyOptions {
  verify?: boolean;
}

export async function commandApply(config: MigraguardConfig, options?: ApplyOptions): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [], failed: null, errors: [] };
  const verify = options?.verify ?? false;

  if (verify) {
    const schemaPath = resolveFromConfig(config, config.schemaFile);
    if (existsSync(schemaPath)) {
      console.log(chalk.blue('Verifying schema before apply...'));
      const savedSchema = await readFile(schemaPath, 'utf-8');
      const currentSchema = await dumpSchema(config);
      if (savedSchema !== currentSchema) {
        result.errors.push('Schema drift detected: current DB schema does not match saved schema.sql. Aborting apply.');
        console.error(chalk.red('✗ Schema drift detected. Aborting apply.'));
        return result;
      }
      console.log(chalk.green('  ✓ Schema in sync.'));
    }
  }

  const db = new MigraguardDb(config);

  try {
    await db.connect();
    await db.ensureTable();
    await db.acquireAdvisoryLock();

    const files = await scanMigrations(config);
    if (files.length === 0) {
      console.log(chalk.yellow('No migration files found.'));
      return result;
    }

    const allRecords = await db.getAllRecords();
    const latestFileName = files[files.length - 1].fileName;

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
      const isLatestFile = file.fileName === latestFileName;

      if (!latestRecord) {
        // No records: new file → apply
        const psqlResult = await executePsqlFile(config, file.filePath);
        if (psqlResult.success) {
          await db.insertRecord(file.fileName, currentChecksum, 'applied');
          result.applied.push(file.fileName);
          console.log(chalk.green(`  ✓ applied: ${file.fileName}`));
        } else {
          await db.insertRecord(file.fileName, currentChecksum, 'failed');
          result.failed = file.fileName;
          result.errors.push(`Failed to apply ${file.fileName}: ${psqlResult.stderr}`);
          console.error(chalk.red(`  ✗ failed: ${file.fileName}`));
          if (psqlResult.stderr) console.error(chalk.red(`    ${psqlResult.stderr.trim()}`));
          break;
        }
        continue;
      }

      // Has records: check status of latest record
      if (latestRecord.status === 'skipped') {
        result.skipped.push(file.fileName);
        console.log(chalk.gray(`  − skipped (resolved): ${file.fileName}`));
        continue;
      }

      if (latestRecord.status === 'failed') {
        if (isLatestFile) {
          // Latest file with failed status → retry
          console.log(chalk.yellow(`  ↻ retrying failed: ${file.fileName}`));
          const psqlResult = await executePsqlFile(config, file.filePath);
          if (psqlResult.success) {
            await db.insertRecord(file.fileName, currentChecksum, 'applied');
            result.applied.push(file.fileName);
            console.log(chalk.green(`  ✓ applied (retry): ${file.fileName}`));
          } else {
            await db.insertRecord(file.fileName, currentChecksum, 'failed');
            result.failed = file.fileName;
            result.errors.push(`Retry failed for ${file.fileName}: ${psqlResult.stderr}`);
            console.error(chalk.red(`  ✗ retry failed: ${file.fileName}`));
            break;
          }
        } else {
          // Non-latest with failed → error stop
          result.failed = file.fileName;
          result.errors.push(
            `Unresolved failed migration: "${file.fileName}". ` +
            `Use "migraguard resolve ${file.fileName}" or squash to fix.`,
          );
          console.error(chalk.red(`  ✗ unresolved: ${file.fileName}`));
          break;
        }
        continue;
      }

      // status === 'applied'
      if (latestRecord.checksum === currentChecksum) {
        result.skipped.push(file.fileName);
        continue;
      }

      // Checksum mismatch
      const pastChecksums = getPastChecksums(fileRecords, latestRecord);
      if (pastChecksums.has(currentChecksum)) {
        result.failed = file.fileName;
        result.errors.push(
          `Ancestor revert detected for "${file.fileName}": ` +
          `current checksum matches a past version, not the latest.`,
        );
        console.error(chalk.red(`  ✗ ancestor revert: ${file.fileName}`));
        break;
      }

      if (isLatestFile) {
        // Latest file with changed checksum → re-apply (idempotent)
        console.log(chalk.yellow(`  ↻ re-applying (changed): ${file.fileName}`));
        const psqlResult = await executePsqlFile(config, file.filePath);
        if (psqlResult.success) {
          await db.insertRecord(file.fileName, currentChecksum, 'applied');
          result.applied.push(file.fileName);
          console.log(chalk.green(`  ✓ applied (re-apply): ${file.fileName}`));
        } else {
          await db.insertRecord(file.fileName, currentChecksum, 'failed');
          result.failed = file.fileName;
          result.errors.push(`Re-apply failed for ${file.fileName}: ${psqlResult.stderr}`);
          console.error(chalk.red(`  ✗ re-apply failed: ${file.fileName}`));
          break;
        }
      } else {
        // Non-latest file tampered
        result.failed = file.fileName;
        result.errors.push(
          `Tampering detected: "${file.fileName}" has been modified ` +
          `but is not the latest migration file.`,
        );
        console.error(chalk.red(`  ✗ tampered: ${file.fileName}`));
        break;
      }
    }
  } finally {
    await db.close();
  }

  if (result.errors.length === 0) {
    if (result.applied.length > 0) {
      console.log(chalk.green(`\n✓ Applied ${result.applied.length} migration(s).`));
    } else {
      console.log(chalk.green('\n✓ All migrations are up to date.'));
    }

    if (verify && result.applied.length > 0) {
      console.log(chalk.blue('Updating schema dump after apply...'));
      const newSchema = await dumpSchema(config);
      const schemaPath = resolveFromConfig(config, config.schemaFile);
      await writeFile(schemaPath, newSchema, 'utf-8');
      console.log(chalk.green(`  ✓ Updated: ${config.schemaFile}`));
    }
  } else {
    console.error(chalk.red(`\n✗ Apply stopped due to errors.`));
  }

  return result;
}
