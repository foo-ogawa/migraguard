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

  it('returns ok when lint is disabled', async () => {
    const config = buildConfig({
      migrationsDir: 'db/migrations',
      lint: { squawk: false },
    }, tempDir);
    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.filesLinted).toBe(0);
  });

  it('returns ok when no migration files exist', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    // This will either pass (if squawk is installed) or throw (if not)
    try {
      const result = await commandLint(config);
      expect(result.ok).toBe(true);
      expect(result.filesLinted).toBe(0);
    } catch (err: unknown) {
      // squawk not installed — acceptable in test env
      expect((err as Error).message).toContain('Squawk is not installed');
    }
  });

  it('throws when squawk is not available and lint is enabled', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, '20260301_120000__test.sql'), 'CREATE TABLE test;');

    // Override PATH to ensure squawk is not found
    const origPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      await expect(commandLint(config)).rejects.toThrow('Squawk is not installed');
    } finally {
      process.env['PATH'] = origPath;
    }
  });
});
