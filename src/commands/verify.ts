import { randomBytes } from 'node:crypto';
import { writeFile, unlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import chalk from 'chalk';
import type { MigraguardConfig, ConnectionConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { executeSqlFile, spawnWithStdin } from '../executor.js';
import { runCapturing } from '../exec.js';
import { dumpSchema } from '../dumper.js';
import { createDb, safeGetAllRecords } from '../db.js';
import { writeJson } from '../output.js';
import type { OutputFormat } from '../output.js';

const { Client } = pg;

export interface VerifyOptions {
  all?: boolean;
  format?: OutputFormat;
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

function shadowId(): string {
  return randomBytes(4).toString('hex');
}

/* ---------- PostgreSQL shadow helpers ---------- */

function buildPgEnv(conn: ConnectionConfig): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env['PGHOST'] = conn.host;
  env['PGPORT'] = String(conn.port);
  env['PGUSER'] = conn.user;
  if (conn.password) env['PGPASSWORD'] = conn.password;
  return env;
}

async function createPgShadow(conn: ConnectionConfig, dbName: string): Promise<void> {
  const client = new Client({
    host: conn.host, port: conn.port, database: 'postgres',
    user: conn.user, password: conn.password,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  await client.query('SET statement_timeout = 30000');
  try { await client.query(`CREATE DATABASE "${dbName}"`); } finally { await client.end(); }
}

async function dropPgShadow(conn: ConnectionConfig, dbName: string): Promise<void> {
  const client = new Client({
    host: conn.host, port: conn.port, database: 'postgres',
    user: conn.user, password: conn.password,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  await client.query('SET statement_timeout = 30000');
  try { await client.query(`DROP DATABASE IF EXISTS "${dbName}"`); } finally { await client.end(); }
}

async function dumpPgSourceToShadow(config: MigraguardConfig, shadowName: string): Promise<void> {
  const conn = config.connection;
  const env = buildPgEnv(conn);
  const pgDumpCmd = config.dump.pgDumpCommand;

  let dumpOutput: string;
  if (pgDumpCmd && pgDumpCmd.length > 0) {
    const [cmd, ...baseArgs] = pgDumpCmd;
    const { stdout } = await runCapturing(cmd, [...baseArgs, '--no-owner', '--no-privileges']);
    dumpOutput = stdout;
  } else {
    env['PGDATABASE'] = conn.database;
    const { stdout } = await runCapturing('pg_dump', ['--no-owner', '--no-privileges'], env);
    dumpOutput = stdout;
  }

  const tmpFile = join(tmpdir(), `migraguard-dump-${randomBytes(4).toString('hex')}.sql`);
  await writeFile(tmpFile, dumpOutput, 'utf-8');
  try {
    const restoreEnv = buildPgEnv(conn);
    restoreEnv['PGDATABASE'] = shadowName;
    await runCapturing('psql', ['-v', 'ON_ERROR_STOP=1', '-f', tmpFile], restoreEnv);
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

/* ---------- MySQL shadow helpers ---------- */

async function createMysqlShadow(config: MigraguardConfig, dbName: string): Promise<void> {
  const args = [
    `--host=${config.connection.host}`,
    `--port=${config.connection.port}`,
    `--user=${config.connection.user}`,
  ];
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (config.connection.password) env['MYSQL_PWD'] = config.connection.password;

  const safeName = dbName.replace(/`/g, '``');
  await spawnWithStdin('mysql', args, `CREATE DATABASE \`${safeName}\`;`, env);
}

async function dropMysqlShadow(config: MigraguardConfig, dbName: string): Promise<void> {
  const args = [
    `--host=${config.connection.host}`,
    `--port=${config.connection.port}`,
    `--user=${config.connection.user}`,
  ];
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (config.connection.password) env['MYSQL_PWD'] = config.connection.password;

  const safeName = dbName.replace(/`/g, '``');
  await spawnWithStdin('mysql', args, `DROP DATABASE IF EXISTS \`${safeName}\`;`, env);
}

async function dumpMysqlSourceToShadow(config: MigraguardConfig, shadowName: string): Promise<void> {
  const conn = config.connection;
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (conn.password) env['MYSQL_PWD'] = conn.password;

  const { stdout: dumpOutput } = await runCapturing('mysqldump', [
    `--host=${conn.host}`, `--port=${conn.port}`, `--user=${conn.user}`,
    conn.database,
  ], env);

  const restoreArgs = [
    `--host=${conn.host}`, `--port=${conn.port}`, `--user=${conn.user}`,
    `--database=${shadowName}`,
  ];
  await spawnWithStdin('mysql', restoreArgs, dumpOutput, env);
}

/* ---------- SQLite shadow helpers ---------- */

async function dumpSqliteSourceToShadow(config: MigraguardConfig, shadowPath: string): Promise<void> {
  await copyFile(config.connection.database, shadowPath);
}

async function dropSqliteShadow(shadowPath: string): Promise<void> {
  await unlink(shadowPath).catch(() => {});
  await unlink(shadowPath + '-wal').catch(() => {});
  await unlink(shadowPath + '-shm').catch(() => {});
}

/* ---------- Dialect dispatcher ---------- */

function shadowName(config: MigraguardConfig, id: string): string {
  if (config.dialect === 'sqlite') {
    return join(tmpdir(), `migraguard_shadow_${id}.sqlite3`);
  }
  return `migraguard_shadow_${id}`;
}

async function createShadow(config: MigraguardConfig, name: string): Promise<void> {
  switch (config.dialect) {
    case 'mysql': return createMysqlShadow(config, name);
    case 'sqlite': return; // created on first access
    default: return createPgShadow(config.connection, name);
  }
}

async function dropShadow(config: MigraguardConfig, name: string): Promise<void> {
  switch (config.dialect) {
    case 'mysql': return dropMysqlShadow(config, name);
    case 'sqlite': return dropSqliteShadow(name);
    default: return dropPgShadow(config.connection, name);
  }
}

async function cloneSourceToShadow(config: MigraguardConfig, name: string): Promise<void> {
  switch (config.dialect) {
    case 'mysql': return dumpMysqlSourceToShadow(config, name);
    case 'sqlite': return dumpSqliteSourceToShadow(config, name);
    default: return dumpPgSourceToShadow(config, name);
  }
}

function buildShadowConfig(config: MigraguardConfig, name: string): MigraguardConfig {
  return {
    ...config,
    connection: { ...config.connection, database: name },
    dump: { ...config.dump, pgDumpCommand: undefined },
  };
}

function buildShadowDumpConfig(config: MigraguardConfig, name: string): MigraguardConfig {
  if (config.dialect !== 'postgresql') {
    return buildShadowConfig(config, name);
  }
  const basePgDumpCmd = config.dump.pgDumpCommand;
  let pgDumpCommand: string[] | undefined;
  if (basePgDumpCmd && basePgDumpCmd.length > 0) {
    pgDumpCommand = [...basePgDumpCmd];
    const dbFlagIdx = pgDumpCommand.indexOf('-d');
    if (dbFlagIdx >= 0 && dbFlagIdx + 1 < pgDumpCommand.length) {
      pgDumpCommand[dbFlagIdx + 1] = name;
    } else {
      pgDumpCommand.push('-d', name);
    }
  }
  return {
    ...config,
    connection: { ...config.connection, database: name },
    dump: { ...config.dump, pgDumpCommand },
  };
}

/* ---------- Core verify logic ---------- */

async function getAppliedFiles(config: MigraguardConfig): Promise<Set<string>> {
  const db = createDb(config);
  try {
    await db.connect();
    const records = await safeGetAllRecords(db);
    return new Set(
      records
        .filter((r) => r.status === 'applied' || r.status === 'skipped')
        .map((r) => r.fileName),
    );
  } catch {
    return new Set();
  } finally {
    await db.close();
  }
}

async function verifyFile(
  file: { fileName: string; filePath: string },
  sConfig: MigraguardConfig,
  sDumpConfig: MigraguardConfig,
): Promise<VerifyFileResult> {
  const firstApply = await executeSqlFile(sConfig, file.filePath);
  if (!firstApply.success) {
    return { fileName: file.fileName, passed: false, firstApplyError: firstApply.stderr.trim() };
  }

  const snapshot1 = await dumpSchema(sDumpConfig);

  const secondApply = await executeSqlFile(sConfig, file.filePath);
  if (!secondApply.success) {
    return { fileName: file.fileName, passed: false, secondApplyError: secondApply.stderr.trim() };
  }

  const snapshot2 = await dumpSchema(sDumpConfig);
  const drift = snapshot1 !== snapshot2;
  return { fileName: file.fileName, passed: !drift, schemaDrift: drift || undefined };
}

export async function commandVerify(
  config: MigraguardConfig,
  options?: VerifyOptions,
): Promise<VerifyResult> {
  const allMode = options?.all ?? false;
  const json = options?.format === 'json';
  // Progress lines go to stderr in json format so that stdout carries the result document only.
  const log = json ? console.error : console.log;
  const id = shadowId();
  const name = shadowName(config, id);
  const files = await scanMigrations(config);
  const results: VerifyFileResult[] = [];

  if (files.length === 0) {
    log(chalk.yellow('No migration files to verify.'));
  } else {
    log(chalk.bold(`\nVerifying idempotency using shadow DB: ${name}`));
    if (allMode) {
      log(chalk.gray('  Mode: --all (verify all migrations from scratch)\n'));
    } else {
      log(chalk.gray('  Mode: incremental (restore current DB, verify pending)\n'));
    }

    try {
      await createShadow(config, name);
      const sConfig = buildShadowConfig(config, name);
      const sDumpConfig = buildShadowDumpConfig(config, name);

      const verifiableFiles = files.filter((f) => f.phase !== 'backfill');

      if (allMode) {
        for (const file of verifiableFiles) {
          const r = await verifyFile(file, sConfig, sDumpConfig);
          results.push(r);
          printVerifyFileResult(log, r);
        }
      } else {
        log(chalk.blue('  Restoring current DB schema to shadow...'));
        await cloneSourceToShadow(config, name);
        log(chalk.green('  ✓ Schema restored.\n'));

        const appliedFiles = await getAppliedFiles(config);
        const pendingFiles = verifiableFiles.filter((f) => !appliedFiles.has(f.fileName));

        if (pendingFiles.length === 0) {
          log(chalk.green('  All migrations already applied. Nothing to verify.'));
        } else {
          log(chalk.gray(`  ${appliedFiles.size} applied, ${pendingFiles.length} pending to verify\n`));
          for (const file of pendingFiles) {
            const r = await verifyFile(file, sConfig, sDumpConfig);
            results.push(r);
            printVerifyFileResult(log, r);
          }
        }
      }
    } finally {
      await dropShadow(config, name);
      log(chalk.gray(`\n  Shadow DB "${name}" dropped.`));
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  log('');
  if (failed === 0 && results.length > 0) {
    log(chalk.green(`✓ All ${passed} migration(s) are idempotent.`));
  } else if (failed > 0) {
    log(chalk.red(`✗ ${failed}/${results.length} migration(s) failed idempotency check.`));
  }

  const result: VerifyResult = { files: results, passed, failed, shadowDbName: name };
  if (json) writeJson(result);
  return result;
}

function printVerifyFileResult(log: (message: string) => void, r: VerifyFileResult): void {
  if (r.passed) {
    log(chalk.green(`  ✓ ${r.fileName}`));
  } else {
    log(chalk.red(`  ✗ ${r.fileName}`));
    if (r.firstApplyError) log(chalk.red(`      1st apply error: ${r.firstApplyError}`));
    if (r.secondApplyError) log(chalk.red(`      2nd apply error: ${r.secondApplyError}`));
    if (r.schemaDrift) log(chalk.red(`      Schema changed between 1st and 2nd apply`));
  }
}
