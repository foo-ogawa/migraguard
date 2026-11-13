import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { commandLint } from '../../src/commands/lint.js';
import { commandSquash } from '../../src/commands/squash.js';

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

  describe('files that can no longer change', () => {
    const wrap = (ddl: string) => [
      "SET lock_timeout = '5s';",
      "SET statement_timeout = '30s';",
      ddl,
      'RESET lock_timeout;',
      'RESET statement_timeout;',
    ].join('\n');
    // Violates ban-unstable-list-predicate only.
    const unstableList = (table: string) => wrap(
      `CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY, s varchar(20), CONSTRAINT ${table}_s CHECK (s IN ('a', 'b')));`,
    );
    const clean = (table: string, ref?: string) => wrap(
      `CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY${ref ? `, ${ref}_id INT REFERENCES ${ref}(id)` : ''});`,
    );

    async function addFile(name: string, sql: string) {
      const migDir = join(tempDir, 'db', 'migrations');
      await mkdir(migDir, { recursive: true });
      await writeFile(join(migDir, name), sql);
    }

    function unstableListFiles(result: Awaited<ReturnType<typeof commandLint>>) {
      return result.violations
        .filter((v) => v.rule === 'ban-unstable-list-predicate')
        .map((v) => v.file);
    }

    it('linear: a released file is not linted once a newer file exists', async () => {
      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      await addFile('20260301_120000__a.sql', unstableList('a'));
      await commandSquash(config);
      await addFile('20260302_120000__b.sql', clean('b'));

      const result = await commandLint(config);
      expect(result.ok).toBe(true);
      expect(result.filesLinted).toBe(1);
      expect(result.filesSkipped).toBe(1);
    });

    it('linear: the same violation in the new file still fails', async () => {
      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      await addFile('20260301_120000__a.sql', unstableList('a'));
      await commandSquash(config);
      await addFile('20260302_120000__b.sql', unstableList('b'));

      const result = await commandLint(config);
      expect(result.ok).toBe(false);
      expect(unstableListFiles(result)).toEqual(['20260302_120000__b.sql']);
    });

    it('linear: the recorded tail file is still linted', async () => {
      const config = buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
      await addFile('20260301_120000__a.sql', unstableList('a'));
      await commandSquash(config);

      const result = await commandLint(config);
      expect(unstableListFiles(result)).toEqual(['20260301_120000__a.sql']);
    });

    it('DAG via config: a recorded file another file depends on is not linted; the leaf is', async () => {
      const config = buildConfig({ model: 'dag', migrationsDir: 'db/migrations' }, tempDir);
      await addFile('20260301_120000__a.sql', unstableList('a'));
      await commandSquash(config);
      await addFile('20260302_120000__b.sql', unstableList('b').replace('PRIMARY KEY,', 'PRIMARY KEY, a_id INT REFERENCES a(id),'));
      await commandSquash(config);

      const result = await commandLint(config);
      expect(unstableListFiles(result)).toEqual(['20260302_120000__b.sql']);
      expect(result.filesSkipped).toBe(1);
    });

    it('DAG: a new file is linted even when another new file depends on it', async () => {
      const config = buildConfig({ model: 'dag', migrationsDir: 'db/migrations' }, tempDir);
      await addFile('20260301_120000__a.sql', unstableList('a'));
      await addFile('20260302_120000__b.sql', clean('b', 'a'));

      const result = await commandLint(config);
      expect(unstableListFiles(result)).toEqual(['20260301_120000__a.sql']);
    });

    it('generic dialect: a released file is not linted once a newer file exists', async () => {
      const config = buildConfig({ dialect: 'sqlite', migrationsDir: 'db/migrations' }, tempDir);
      await addFile('20260301_120000__a.sql', 'DROP TABLE IF EXISTS legacy;');
      await commandSquash(config);
      await addFile('20260302_120000__b.sql', 'CREATE TABLE IF NOT EXISTS b (id INTEGER PRIMARY KEY);');

      const result = await commandLint(config);
      expect(result.ok).toBe(true);
      expect(result.filesSkipped).toBe(1);

      await addFile('20260303_120000__c.sql', 'DROP TABLE IF EXISTS b;');
      const failing = await commandLint(config);
      expect(failing.ok).toBe(false);
      expect(failing.violations.map((v) => v.file)).toEqual(['20260303_120000__c.sql']);
    });
  });
});
