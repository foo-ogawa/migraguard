import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { MigraguardConfig } from './config.js';
import { executePsqlFile } from './psql.js';
import type { PsqlResult } from './psql.js';

export type SqlExecResult = PsqlResult;

export async function executeSqlFile(
  config: MigraguardConfig,
  filePath: string,
): Promise<SqlExecResult> {
  switch (config.dialect) {
    case 'mysql':
      return executeMysqlFile(config, filePath);
    case 'sqlite':
      return executeSqliteFile(config, filePath);
    default:
      return executePsqlFile(config, filePath);
  }
}

async function executeMysqlFile(
  config: MigraguardConfig,
  filePath: string,
): Promise<SqlExecResult> {
  const args = [
    `--host=${config.connection.host}`,
    `--port=${config.connection.port}`,
    `--user=${config.connection.user}`,
    `--database=${config.connection.database}`,
    '--batch',
  ];
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (config.connection.password) {
    env['MYSQL_PWD'] = config.connection.password;
  }

  const sql = await readFile(filePath, 'utf-8');
  return spawnWithStdin('mysql', args, sql, env);
}

async function executeSqliteFile(
  config: MigraguardConfig,
  filePath: string,
): Promise<SqlExecResult> {
  const sql = await readFile(filePath, 'utf-8');
  return spawnWithStdin('sqlite3', ['-bail', config.connection.database], sql);
}

export function spawnWithStdin(
  cmd: string,
  args: string[],
  input: string,
  env?: Record<string, string>,
): Promise<SqlExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env ?? (process.env as Record<string, string>),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      resolve({ success: false, stdout, stderr: err.message });
    });
    proc.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr });
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
