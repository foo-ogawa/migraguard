import { describe, it, expect } from 'vitest';
import { buildConfig } from '../src/config.js';
import { executeSqlFile } from '../src/executor.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('executeSqlFile', () => {
  it('dispatches to sqlite3 CLI for sqlite dialect', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mg-exec-'));
    const dbPath = join(tmpDir, 'test.db');
    const sqlPath = join(tmpDir, 'migration.sql');

    await writeFile(sqlPath, 'CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT);', 'utf-8');

    const config = buildConfig({
      dialect: 'sqlite',
      connection: { database: dbPath },
    }, tmpDir);

    const result = await executeSqlFile(config, sqlPath);
    expect(result.success).toBe(true);

    const verifyPath = join(tmpDir, 'verify.sql');
    await writeFile(verifyPath, "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table';", 'utf-8');
    const verify = await executeSqlFile(config, verifyPath);
    expect(verify.success).toBe(true);
    expect(verify.stdout).toContain('test_table');

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('sqlite3 fails with -bail on error', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'mg-exec-'));
    const dbPath = join(tmpDir, 'test.db');
    const sqlPath = join(tmpDir, 'bad.sql');

    await writeFile(sqlPath, 'THIS IS NOT SQL;', 'utf-8');

    const config = buildConfig({
      dialect: 'sqlite',
      connection: { database: dbPath },
    }, tmpDir);

    const result = await executeSqlFile(config, sqlPath);
    expect(result.success).toBe(false);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('executeSqlFile returns psql dispatch for postgresql', async () => {
    const config = buildConfig({ dialect: 'postgresql' }, '/tmp');
    const result = await executeSqlFile(config, '/nonexistent/file.sql');
    expect(result.success).toBe(false);
  });
});
