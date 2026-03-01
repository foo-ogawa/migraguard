import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../src/config.js';
import { scanMigrations } from '../src/scanner.js';

describe('scanner', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when migrationsDir does not exist', async () => {
    const config = buildConfig({ migrationsDir: 'nonexistent' }, tempDir);
    const files = await scanMigrations(config);
    expect(files).toEqual([]);
  });

  it('returns empty array when migrationsDir is empty', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const files = await scanMigrations(config);
    expect(files).toEqual([]);
  });

  it('scans and sorts migration files by timestamp', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, '20260302_093000__add_email_index.sql'), 'SELECT 1;');
    await writeFile(join(migDir, '20260301_120000__create_users_table.sql'), 'SELECT 1;');
    await writeFile(join(migDir, '20260303_150000__add_orders.sql'), 'SELECT 1;');

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const files = await scanMigrations(config);

    expect(files).toHaveLength(3);
    expect(files[0].fileName).toBe('20260301_120000__create_users_table.sql');
    expect(files[1].fileName).toBe('20260302_093000__add_email_index.sql');
    expect(files[2].fileName).toBe('20260303_150000__add_orders.sql');
  });

  it('ignores non-SQL files', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, '20260301_120000__create_users.sql'), 'SELECT 1;');
    await writeFile(join(migDir, 'README.md'), '# README');
    await writeFile(join(migDir, '.gitkeep'), '');

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const files = await scanMigrations(config);

    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('20260301_120000__create_users.sql');
  });

  it('ignores SQL files that do not match naming pattern', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, '20260301_120000__valid_name.sql'), 'SELECT 1;');
    await writeFile(join(migDir, 'arbitrary.sql'), 'SELECT 1;');

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const files = await scanMigrations(config);

    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('20260301_120000__valid_name.sql');
  });

  it('includes correct filePath', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, '20260301_120000__test.sql'), 'SELECT 1;');

    const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
    const files = await scanMigrations(config);

    expect(files[0].filePath).toBe(join(migDir, '20260301_120000__test.sql'));
  });

  it('scans multiple directories and merges results sorted', async () => {
    const dir1 = join(tempDir, 'db', 'core');
    const dir2 = join(tempDir, 'db', 'auth');
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir1, '20260301_120000__create_users.sql'), 'SELECT 1;');
    await writeFile(join(dir2, '20260302_093000__add_auth.sql'), 'SELECT 1;');
    await writeFile(join(dir1, '20260303_150000__add_orders.sql'), 'SELECT 1;');

    const config = buildConfig({ migrationsDirs: ['db/core', 'db/auth'] }, tempDir);
    const files = await scanMigrations(config);

    expect(files).toHaveLength(3);
    expect(files[0].fileName).toBe('20260301_120000__create_users.sql');
    expect(files[0].sourceDir).toBe('db/core');
    expect(files[1].fileName).toBe('20260302_093000__add_auth.sql');
    expect(files[1].sourceDir).toBe('db/auth');
    expect(files[2].fileName).toBe('20260303_150000__add_orders.sql');
    expect(files[2].sourceDir).toBe('db/core');
  });

  it('skips non-existent directories in migrationsDirs', async () => {
    const dir1 = join(tempDir, 'db', 'exists');
    await mkdir(dir1, { recursive: true });
    await writeFile(join(dir1, '20260301_120000__test.sql'), 'SELECT 1;');

    const config = buildConfig({ migrationsDirs: ['db/exists', 'db/missing'] }, tempDir);
    const files = await scanMigrations(config);

    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('20260301_120000__test.sql');
  });

  it('works with prefix naming pattern', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, 'auth_20260301_120000__create_users.sql'), 'SELECT 1;');
    await writeFile(join(migDir, 'auth_20260302_093000__add_index.sql'), 'SELECT 1;');

    const config = buildConfig({
      migrationsDir: 'db/migrations',
      naming: {
        pattern: '{prefix}_{timestamp}__{description}.sql',
        timestamp: 'YYYYMMDD_HHMMSS',
        prefix: 'auth',
        sortKey: 'timestamp',
      },
    }, tempDir);
    const files = await scanMigrations(config);

    expect(files).toHaveLength(2);
    expect(files[0].parsed.description).toBe('create_users');
    expect(files[1].parsed.description).toBe('add_index');
  });
});
