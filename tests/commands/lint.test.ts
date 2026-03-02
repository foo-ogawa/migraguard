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

  it('detects violations in unsafe SQL', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(
      join(migDir, '20260301_120000__test.sql'),
      'CREATE TABLE users (id SERIAL PRIMARY KEY);',
    );

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const result = await commandLint(config);
    expect(result.ok).toBe(false);
    expect(result.violations).toBeGreaterThan(0);
  });

  it('passes for well-written migration', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(
      join(migDir, '20260301_120000__test.sql'),
      "SET lock_timeout = '5s';\nCREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);",
    );

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
  });

  it('allows disabling specific rules', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(
      join(migDir, '20260301_120000__test.sql'),
      'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);',
    );

    const config = buildConfig({
      migrationsDir: 'db/migrations',
      lint: { rules: { 'require-lock-timeout': false } },
    }, tempDir);

    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
  });
});
