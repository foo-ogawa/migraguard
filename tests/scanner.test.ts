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

  describe('Class B (expand/contract) directories', () => {
    it('scans phase files inside a migration group directory', async () => {
      const migDir = join(tempDir, 'db', 'migrations');
      const groupDir = join(migDir, '20260315_100000__rename_user_status');
      await mkdir(groupDir, { recursive: true });
      await writeFile(join(groupDir, '1_expand.sql'), 'ALTER TABLE users ADD COLUMN IF NOT EXISTS status_v2 VARCHAR(32);');
      await writeFile(join(groupDir, '2_backfill.sql'), 'UPDATE users SET status_v2 = status WHERE status_v2 IS NULL;');
      await writeFile(join(groupDir, '3_switch.sql'), 'CREATE OR REPLACE VIEW user_status AS SELECT id, status_v2 FROM users;');
      await writeFile(join(groupDir, '4_contract.sql'), 'ALTER TABLE users DROP COLUMN IF EXISTS status;');

      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      const files = await scanMigrations(config);

      expect(files).toHaveLength(4);
      expect(files[0].migrationClass).toBe('expand_contract');
      expect(files[0].phase).toBe('expand');
      expect(files[0].groupName).toBe('20260315_100000__rename_user_status');
      expect(files[0].fileName).toBe('20260315_100000__rename_user_status/1_expand.sql');

      expect(files[1].phase).toBe('backfill');
      expect(files[2].phase).toBe('switch');
      expect(files[3].phase).toBe('contract');
    });

    it('mixes Class A and Class B files sorted by timestamp', async () => {
      const migDir = join(tempDir, 'db', 'migrations');
      await mkdir(migDir, { recursive: true });

      await writeFile(join(migDir, '20260301_120000__create_users.sql'), 'CREATE TABLE users (id SERIAL);');

      const groupDir = join(migDir, '20260315_100000__rename_status');
      await mkdir(groupDir, { recursive: true });
      await writeFile(join(groupDir, '1_expand.sql'), 'SELECT 1;');
      await writeFile(join(groupDir, '4_contract.sql'), 'SELECT 1;');

      await writeFile(join(migDir, '20260320_090000__add_orders.sql'), 'CREATE TABLE orders (id SERIAL);');

      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      const files = await scanMigrations(config);

      expect(files).toHaveLength(4);
      expect(files[0].fileName).toBe('20260301_120000__create_users.sql');
      expect(files[0].migrationClass).toBe('safe');

      expect(files[1].fileName).toBe('20260315_100000__rename_status/1_expand.sql');
      expect(files[1].migrationClass).toBe('expand_contract');

      expect(files[2].fileName).toBe('20260315_100000__rename_status/4_contract.sql');
      expect(files[2].migrationClass).toBe('expand_contract');

      expect(files[3].fileName).toBe('20260320_090000__add_orders.sql');
      expect(files[3].migrationClass).toBe('safe');
    });

    it('ignores directories that do not match naming pattern', async () => {
      const migDir = join(tempDir, 'db', 'migrations');
      const invalidDir = join(migDir, 'not_a_migration');
      await mkdir(invalidDir, { recursive: true });
      await writeFile(join(invalidDir, '1_expand.sql'), 'SELECT 1;');
      await writeFile(join(migDir, '20260301_120000__valid.sql'), 'SELECT 1;');

      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      const files = await scanMigrations(config);

      expect(files).toHaveLength(1);
      expect(files[0].fileName).toBe('20260301_120000__valid.sql');
    });

    it('ignores directories with no valid phase files', async () => {
      const migDir = join(tempDir, 'db', 'migrations');
      const groupDir = join(migDir, '20260315_100000__empty_group');
      await mkdir(groupDir, { recursive: true });
      await writeFile(join(groupDir, 'README.md'), '# notes');

      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      const files = await scanMigrations(config);

      expect(files).toHaveLength(0);
    });

    it('attaches phaseFiles to each migration file in a group', async () => {
      const migDir = join(tempDir, 'db', 'migrations');
      const groupDir = join(migDir, '20260315_100000__rename_status');
      await mkdir(groupDir, { recursive: true });
      await writeFile(join(groupDir, '1_expand.sql'), 'SELECT 1;');
      await writeFile(join(groupDir, '2_backfill.sql'), 'SELECT 1;');

      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      const files = await scanMigrations(config);

      expect(files).toHaveLength(2);
      expect(files[0].phaseFiles).toHaveLength(2);
      expect(files[0].phaseFiles![0].phase).toBe('expand');
      expect(files[0].phaseFiles![1].phase).toBe('backfill');
    });
  });
});
