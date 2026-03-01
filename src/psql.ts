import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MigraguardConfig } from './config.js';

const execFileAsync = promisify(execFile);

export interface PsqlResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

function buildPsqlEnv(config: MigraguardConfig): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  env['PGHOST'] = config.connection.host;
  env['PGPORT'] = String(config.connection.port);
  env['PGDATABASE'] = config.connection.database;
  env['PGUSER'] = config.connection.user;
  if (config.connection.password) {
    env['PGPASSWORD'] = config.connection.password;
  }
  return env;
}

export async function executePsqlFile(config: MigraguardConfig, filePath: string): Promise<PsqlResult> {
  const env = buildPsqlEnv(config);
  try {
    const { stdout, stderr } = await execFileAsync(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '-f', filePath],
      { env },
    );
    return { success: true, stdout, stderr };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    return {
      success: false,
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? '',
    };
  }
}

export async function isPsqlAvailable(): Promise<boolean> {
  try {
    await execFileAsync('psql', ['--version']);
    return true;
  } catch {
    return false;
  }
}
