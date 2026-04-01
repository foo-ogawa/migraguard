import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MigraguardConfig } from './config.js';

const execFileAsync = promisify(execFile);

function buildPgDumpEnv(config: MigraguardConfig): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env['PGHOST'] = config.connection.host;
  env['PGPORT'] = String(config.connection.port);
  env['PGDATABASE'] = config.connection.database;
  env['PGUSER'] = config.connection.user;
  if (config.connection.password) {
    env['PGPASSWORD'] = config.connection.password;
  }
  return env;
}

export async function dumpSchema(config: MigraguardConfig): Promise<string> {
  switch (config.dialect) {
    case 'mysql':
      return dumpMysqlSchema(config);
    case 'sqlite':
      return dumpSqliteSchema(config);
    default:
      return dumpPgSchema(config);
  }
}

async function dumpPgSchema(config: MigraguardConfig): Promise<string> {
  const pgDumpCmd = config.dump.pgDumpCommand;

  const dumpArgs = ['--schema-only'];
  if (config.dump.excludeOwners) dumpArgs.push('--no-owner');
  if (config.dump.excludePrivileges) dumpArgs.push('--no-privileges');

  let stdout: string;

  if (pgDumpCmd && pgDumpCmd.length > 0) {
    const [cmd, ...baseArgs] = pgDumpCmd;
    const { stdout: out } = await execFileAsync(cmd, [...baseArgs, ...dumpArgs]);
    stdout = out;
  } else {
    const env = buildPgDumpEnv(config);
    const { stdout: out } = await execFileAsync('pg_dump', dumpArgs, { env });
    stdout = out;
  }

  if (config.dump.normalize) {
    return normalizeSchema(stdout);
  }
  return stdout;
}

async function dumpMysqlSchema(config: MigraguardConfig): Promise<string> {
  const args = [
    '--no-data',
    '--skip-comments',
    `--host=${config.connection.host}`,
    `--port=${config.connection.port}`,
    `--user=${config.connection.user}`,
    config.connection.database,
  ];
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (config.connection.password) {
    env['MYSQL_PWD'] = config.connection.password;
  }

  const { stdout } = await execFileAsync('mysqldump', args, { env });

  if (config.dump.normalize) {
    return normalizeMysqlSchema(stdout);
  }
  return stdout;
}

async function dumpSqliteSchema(config: MigraguardConfig): Promise<string> {
  const { stdout } = await execFileAsync('sqlite3', [
    config.connection.database,
    '.schema',
  ]);

  if (config.dump.normalize) {
    return normalizeSqliteSchema(stdout);
  }
  return stdout;
}

export function normalizeSchema(raw: string): string {
  const lines = raw.split('\n');
  const filtered = lines.filter((line) => {
    if (line.startsWith('--')) return false;
    if (line.startsWith('SET ')) return false;
    if (line.startsWith('SELECT pg_catalog.')) return false;
    if (line.startsWith('COMMENT ON EXTENSION')) return false;
    if (line.startsWith('\\restrict')) return false;
    if (line.startsWith('\\unrestrict')) return false;
    return true;
  });

  return collapseAndTrim(filtered);
}

function normalizeMysqlSchema(raw: string): string {
  const lines = raw.split('\n');
  const filtered = lines.filter((line) => {
    if (line.startsWith('--')) return false;
    if (line.startsWith('/*')) return false;
    if (line.startsWith('/*!')) return false;
    if (line.startsWith('SET ')) return false;
    if (line.startsWith('LOCK TABLES')) return false;
    if (line.startsWith('UNLOCK TABLES')) return false;
    return true;
  });

  return collapseAndTrim(filtered);
}

function normalizeSqliteSchema(raw: string): string {
  const lines = raw.split('\n');
  const filtered = lines.filter((line) => !line.startsWith('--'));
  return collapseAndTrim(filtered);
}

function collapseAndTrim(lines: string[]): string {
  const result: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    result.push(line);
    prevBlank = isBlank;
  }

  while (result.length > 0 && result[0].trim() === '') result.shift();
  while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();

  return result.join('\n') + '\n';
}
