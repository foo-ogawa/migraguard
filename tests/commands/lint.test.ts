import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { commandLint } from '../../src/commands/lint.js';

describe('commands/lint', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns ok when no migration files exist', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.filesLinted).toBe(0);
  });

  it('detects errors in unsafe SQL', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(
      join(migDir, '20260301_120000__test.sql'),
      'CREATE TABLE users (id SERIAL PRIMARY KEY);',
    );

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const result = await commandLint(config);
    expect(result.ok).toBe(false);
    expect(result.errors).toBeGreaterThan(0);
  });

  it('passes for well-written migration', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    const sql = [
      "SET lock_timeout = '5s';",
      "SET statement_timeout = '30s';",
      'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);',
      'RESET lock_timeout;',
      'RESET statement_timeout;',
    ].join('\n');
    await writeFile(join(migDir, '20260301_120000__test.sql'), sql);

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
  });

  it('allows disabling specific rules with off', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(
      join(migDir, '20260301_120000__test.sql'),
      'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);',
    );

    const config = buildConfig({
      migrationsDir: 'db/migrations',
      lint: {
        rules: {
          'require-lock-timeout': 'off',
          'require-statement-timeout': 'off',
          'require-reset-timeouts': 'off',
        },
      },
    }, tempDir);

    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('warn rules do not cause failure', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(
      join(migDir, '20260301_120000__test.sql'),
      'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);',
    );

    const config = buildConfig({
      migrationsDir: 'db/migrations',
      lint: {
        rules: {
          'require-lock-timeout': 'warn',
          'require-statement-timeout': 'warn',
          'require-reset-timeouts': 'off',
        },
      },
    }, tempDir);

    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.warnings).toBeGreaterThan(0);
  });
});
