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
import { loadMetadata, isDagMode } from '../metadata.js';
import {
  buildDependencyGraph,
  findLeafNodes,
  topologicalSort,
  findTransitiveDependents,
} from '../deps.js';
import type { DependencyGraph } from '../deps.js';

export interface ApplyResult {
  applied: string[];
  skipped: string[];
  failed: string | null;
  blocked: string[];
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
  const result: ApplyResult = { applied: [], skipped: [], failed: null, blocked: [], errors: [] };
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

  const metadata = await loadMetadata(config);
  const dag = isDagMode(metadata);

  let graph: DependencyGraph | null = null;
  let leafSet: Set<string> | null = null;

  if (dag) {
    graph = await buildDependencyGraph(config);
    leafSet = new Set(findLeafNodes(graph));
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
    const recordsByFile = new Map<string, MigrationRecord[]>();
    for (const r of allRecords) {
      const list = recordsByFile.get(r.fileName) ?? [];
      list.push(r);
      recordsByFile.set(r.fileName, list);
    }

    let orderedFileNames: string[];
    if (dag && graph) {
      const sorted = topologicalSort(graph);
      orderedFileNames = sorted ?? files.map((f) => f.fileName);
    } else {
      orderedFileNames = files.map((f) => f.fileName);
    }

    const fileMap = new Map(files.map((f) => [f.fileName, f]));
    const latestFileName = files[files.length - 1].fileName;
    const blockedSet = new Set<string>();

    for (const fileName of orderedFileNames) {
      const file = fileMap.get(fileName);
      if (!file) continue;

      if (blockedSet.has(fileName)) {
        result.blocked.push(fileName);
        console.log(chalk.gray(`  ⊘ blocked: ${fileName}`));
        continue;
      }

      const fileRecords = recordsByFile.get(file.fileName) ?? [];
      const latestRecord = getLatestRecord(fileRecords);
      const currentChecksum = await checksumFile(file.filePath);
      const isEditable = dag && leafSet
        ? leafSet.has(file.fileName)
        : file.fileName === latestFileName;

      const applyResult = await processFile(
        config, db, file.filePath, file.fileName,
        fileRecords, latestRecord, currentChecksum, isEditable,
        result,
      );

      if (applyResult === 'error') {
        if (dag && graph) {
          const dependents = findTransitiveDependents(graph, file.fileName);
          for (const dep of dependents) blockedSet.add(dep);
        } else {
          break;
        }
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

type FileAction = 'ok' | 'error';

async function processFile(
  config: MigraguardConfig,
  db: MigraguardDb,
  filePath: string,
  fileName: string,
  fileRecords: MigrationRecord[],
  latestRecord: MigrationRecord | undefined,
  currentChecksum: string,
  isEditable: boolean,
  result: ApplyResult,
): Promise<FileAction> {
  if (!latestRecord) {
    const psqlResult = await executePsqlFile(config, filePath);
    if (psqlResult.success) {
      await db.insertRecord(fileName, currentChecksum, 'applied');
      result.applied.push(fileName);
      console.log(chalk.green(`  ✓ applied: ${fileName}`));
      return 'ok';
    } else {
      await db.insertRecord(fileName, currentChecksum, 'failed');
      result.failed = result.failed ?? fileName;
      result.errors.push(`Failed to apply ${fileName}: ${psqlResult.stderr}`);
      console.error(chalk.red(`  ✗ failed: ${fileName}`));
      if (psqlResult.stderr) console.error(chalk.red(`    ${psqlResult.stderr.trim()}`));
      return 'error';
    }
  }

  if (latestRecord.status === 'skipped') {
    result.skipped.push(fileName);
    console.log(chalk.gray(`  − skipped (resolved): ${fileName}`));
    return 'ok';
  }

  if (latestRecord.status === 'failed') {
    if (isEditable) {
      console.log(chalk.yellow(`  ↻ retrying failed: ${fileName}`));
      const psqlResult = await executePsqlFile(config, filePath);
      if (psqlResult.success) {
        await db.insertRecord(fileName, currentChecksum, 'applied');
        result.applied.push(fileName);
        console.log(chalk.green(`  ✓ applied (retry): ${fileName}`));
        return 'ok';
      } else {
        await db.insertRecord(fileName, currentChecksum, 'failed');
        result.failed = result.failed ?? fileName;
        result.errors.push(`Retry failed for ${fileName}: ${psqlResult.stderr}`);
        console.error(chalk.red(`  ✗ retry failed: ${fileName}`));
        return 'error';
      }
    } else {
      result.failed = result.failed ?? fileName;
      result.errors.push(
        `Unresolved failed migration: "${fileName}". ` +
        `Use "migraguard resolve ${fileName}" or squash to fix.`,
      );
      console.error(chalk.red(`  ✗ unresolved: ${fileName}`));
      return 'error';
    }
  }

  // status === 'applied'
  if (latestRecord.checksum === currentChecksum) {
    result.skipped.push(fileName);
    return 'ok';
  }

  const pastChecksums = getPastChecksums(fileRecords, latestRecord);
  if (pastChecksums.has(currentChecksum)) {
    result.failed = result.failed ?? fileName;
    result.errors.push(
      `Ancestor revert detected for "${fileName}": ` +
      `current checksum matches a past version, not the latest.`,
    );
    console.error(chalk.red(`  ✗ ancestor revert: ${fileName}`));
    return 'error';
  }

  if (isEditable) {
    console.log(chalk.yellow(`  ↻ re-applying (changed): ${fileName}`));
    const psqlResult = await executePsqlFile(config, filePath);
    if (psqlResult.success) {
      await db.insertRecord(fileName, currentChecksum, 'applied');
      result.applied.push(fileName);
      console.log(chalk.green(`  ✓ applied (re-apply): ${fileName}`));
      return 'ok';
    } else {
      await db.insertRecord(fileName, currentChecksum, 'failed');
      result.failed = result.failed ?? fileName;
      result.errors.push(`Re-apply failed for ${fileName}: ${psqlResult.stderr}`);
      console.error(chalk.red(`  ✗ re-apply failed: ${fileName}`));
      return 'error';
    }
  } else {
    result.failed = result.failed ?? fileName;
    result.errors.push(
      `Tampering detected: "${fileName}" has been modified ` +
      `but is not an editable migration file.`,
    );
    console.error(chalk.red(`  ✗ tampered: ${fileName}`));
    return 'error';
  }
}
