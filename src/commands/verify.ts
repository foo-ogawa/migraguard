import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import chalk from 'chalk';
import type { MigraguardConfig, ConnectionConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { executePsqlFile } from '../psql.js';
import { dumpSchema } from '../dumper.js';

const { Client } = pg;
const execFileAsync = promisify(execFile);

export interface VerifyOptions {
  all?: boolean;
}

export interface VerifyFileResult {
  fileName: string;
  passed: boolean;
  firstApplyError?: string;
  secondApplyError?: string;
  schemaDrift?: boolean;
}

export interface VerifyResult {
  files: VerifyFileResult[];
  passed: number;
  failed: number;
  shadowDbName: string;
}

function shadowDbName(): string {
  const suffix = randomBytes(4).toString('hex');
  return `migraguard_shadow_${suffix}`;
}

function buildEnv(conn: ConnectionConfig): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  env['PGHOST'] = conn.host;
  env['PGPORT'] = String(conn.port);
  env['PGUSER'] = conn.user;
  if (conn.password) env['PGPASSWORD'] = conn.password;
  return env;
}

async function createShadowDb(conn: ConnectionConfig, dbName: string): Promise<void> {
  const client = new Client({
    host: conn.host,
    port: conn.port,
    database: 'postgres',
    user: conn.user,
    password: conn.password,
  });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}

async function dropShadowDb(conn: ConnectionConfig, dbName: string): Promise<void> {
  const client = new Client({
    host: conn.host,
    port: conn.port,
    database: 'postgres',
    user: conn.user,
    password: conn.password,
  });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await client.end();
  }
}

async function dumpSourceToShadow(
  config: MigraguardConfig,
  shadowName: string,
): Promise<void> {
  const conn = config.connection;
  const env = buildEnv(conn);
  const pgDumpCmd = config.dump.pgDumpCommand;

  let dumpOutput: string;
  if (pgDumpCmd && pgDumpCmd.length > 0) {
    const [cmd, ...baseArgs] = pgDumpCmd;
    const { stdout } = await execFileAsync(cmd, [...baseArgs, '--no-owner', '--no-privileges']);
    dumpOutput = stdout;
  } else {
    env['PGDATABASE'] = conn.database;
    const { stdout } = await execFileAsync('pg_dump', ['--no-owner', '--no-privileges'], { env });
    dumpOutput = stdout;
  }

  const tmpFile = join(tmpdir(), `migraguard-dump-${randomBytes(4).toString('hex')}.sql`);
  await writeFile(tmpFile, dumpOutput, 'utf-8');
  try {
    const restoreEnv = buildEnv(conn);
    restoreEnv['PGDATABASE'] = shadowName;
    await execFileAsync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', tmpFile], {
      env: restoreEnv,
      maxBuffer: 50 * 1024 * 1024,
    });
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

function shadowConfig(config: MigraguardConfig, shadowName: string): MigraguardConfig {
  return {
    ...config,
    connection: { ...config.connection, database: shadowName },
    dump: {
      ...config.dump,
      pgDumpCommand: undefined,
    },
  };
}

function shadowDumpConfig(config: MigraguardConfig, shadowName: string): MigraguardConfig {
  const basePgDumpCmd = config.dump.pgDumpCommand;

  let pgDumpCommand: string[] | undefined;
  if (basePgDumpCmd && basePgDumpCmd.length > 0) {
    pgDumpCommand = [...basePgDumpCmd];
    const dbFlagIdx = pgDumpCommand.indexOf('-d');
    if (dbFlagIdx >= 0 && dbFlagIdx + 1 < pgDumpCommand.length) {
      pgDumpCommand[dbFlagIdx + 1] = shadowName;
    } else {
      pgDumpCommand.push('-d', shadowName);
    }
  }

  return {
    ...config,
    connection: { ...config.connection, database: shadowName },
    dump: { ...config.dump, pgDumpCommand },
  };
}

async function getAppliedFiles(config: MigraguardConfig): Promise<Set<string>> {
  const client = new Client({
    host: config.connection.host,
    port: config.connection.port,
    database: config.connection.database,
    user: config.connection.user,
    password: config.connection.password,
  });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT DISTINCT file_name FROM schema_migrations WHERE status IN ('applied', 'skipped')`,
    );
    return new Set(result.rows.map((r: Record<string, unknown>) => r['file_name'] as string));
  } catch {
    return new Set();
  } finally {
    await client.end();
  }
}

async function verifyFile(
  file: { fileName: string; filePath: string },
  sConfig: MigraguardConfig,
  sDumpConfig: MigraguardConfig,
): Promise<VerifyFileResult> {
  const firstApply = await executePsqlFile(sConfig, file.filePath);
  if (!firstApply.success) {
    return {
      fileName: file.fileName,
      passed: false,
      firstApplyError: firstApply.stderr.trim(),
    };
  }

  const snapshot1 = await dumpSchema(sDumpConfig);

  const secondApply = await executePsqlFile(sConfig, file.filePath);
  if (!secondApply.success) {
    return {
      fileName: file.fileName,
      passed: false,
      secondApplyError: secondApply.stderr.trim(),
    };
  }

  const snapshot2 = await dumpSchema(sDumpConfig);
  const drift = snapshot1 !== snapshot2;
  return {
    fileName: file.fileName,
    passed: !drift,
    schemaDrift: drift || undefined,
  };
}

export async function commandVerify(
  config: MigraguardConfig,
  options?: VerifyOptions,
): Promise<VerifyResult> {
  const allMode = options?.all ?? false;
  const dbName = shadowDbName();
  const files = await scanMigrations(config);

  if (files.length === 0) {
    console.log(chalk.yellow('No migration files to verify.'));
    return { files: [], passed: 0, failed: 0, shadowDbName: dbName };
  }

  const results: VerifyFileResult[] = [];

  console.log(chalk.bold(`\nVerifying idempotency using shadow DB: ${dbName}`));
  if (allMode) {
    console.log(chalk.gray('  Mode: --all (verify all migrations from scratch)\n'));
  } else {
    console.log(chalk.gray('  Mode: incremental (restore current DB, verify pending)\n'));
  }

  try {
    await createShadowDb(config.connection, dbName);
    const sConfig = shadowConfig(config, dbName);
    const sDumpConfig = shadowDumpConfig(config, dbName);

    if (allMode) {
      for (const file of files) {
        const r = await verifyFile(file, sConfig, sDumpConfig);
        results.push(r);
        if (r.passed) {
          console.log(chalk.green(`  ✓ ${file.fileName}`));
        } else {
          console.log(chalk.red(`  ✗ ${file.fileName}`));
          if (r.firstApplyError) console.log(chalk.red(`      1st apply error: ${r.firstApplyError}`));
          if (r.secondApplyError) console.log(chalk.red(`      2nd apply error: ${r.secondApplyError}`));
          if (r.schemaDrift) console.log(chalk.red(`      Schema changed between 1st and 2nd apply`));
        }
      }
    } else {
      console.log(chalk.blue('  Restoring current DB schema to shadow...'));
      await dumpSourceToShadow(config, dbName);
      console.log(chalk.green('  ✓ Schema restored.\n'));

      const appliedFiles = await getAppliedFiles(config);
      const pendingFiles = files.filter((f) => !appliedFiles.has(f.fileName));

      if (pendingFiles.length === 0) {
        console.log(chalk.green('  All migrations already applied. Nothing to verify.'));
      } else {
        console.log(chalk.gray(`  ${appliedFiles.size} applied, ${pendingFiles.length} pending to verify\n`));
        for (const file of pendingFiles) {
          const r = await verifyFile(file, sConfig, sDumpConfig);
          results.push(r);
          if (r.passed) {
            console.log(chalk.green(`  ✓ ${file.fileName}`));
          } else {
            console.log(chalk.red(`  ✗ ${file.fileName}`));
            if (r.firstApplyError) console.log(chalk.red(`      1st apply error: ${r.firstApplyError}`));
            if (r.secondApplyError) console.log(chalk.red(`      2nd apply error: ${r.secondApplyError}`));
            if (r.schemaDrift) console.log(chalk.red(`      Schema changed between 1st and 2nd apply`));
          }
        }
      }
    }
  } finally {
    await dropShadowDb(config.connection, dbName);
    console.log(chalk.gray(`\n  Shadow DB "${dbName}" dropped.`));
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('');
  if (failed === 0 && results.length > 0) {
    console.log(chalk.green(`✓ All ${passed} migration(s) are idempotent.`));
  } else if (failed > 0) {
    console.log(chalk.red(`✗ ${failed}/${results.length} migration(s) failed idempotency check.`));
  }

  return { files: results, passed, failed, shadowDbName: dbName };
}
