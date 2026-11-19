import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import type { MigrationRecord } from '../../src/db.js';

const records: MigrationRecord[] = [];

vi.mock('../../src/db.js', () => ({
  createDb: () => ({
    connect: async () => {},
    ensureTable: async () => {},
    acquireAdvisoryLock: async () => {},
    releaseAdvisoryLock: async () => {},
    getAllRecords: async () => records,
    close: async () => {},
  }),
}));

vi.mock('../../src/dumper.js', () => ({
  dumpSchema: async () => 'CREATE TABLE t (id int);\n',
}));

const { commandBaseline } = await import('../../src/commands/baseline.js');

describe('commands/baseline', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migraguard-baseline-'));
    const migDir = join(dir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, '20990101_000000__a.sql'), 'CREATE TABLE a (id int);');
    await writeFile(join(migDir, '20990101_000001__b.sql'), 'CREATE TABLE b (id int);');
    records.length = 0;
    for (const fileName of ['20990101_000000__a.sql', '20990101_000001__b.sql']) {
      records.push({
        fileName, checksum: 'x', status: 'applied', appliedAt: new Date(), resolvedAt: null,
        migrationClass: 'ddl', phase: null, groupName: null, tag: null,
      } as MigrationRecord);
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the baseline history comment ahead of the dumped schema', async () => {
    const config = buildConfig({ migrationsDir: 'db/migrations', schemaFile: 'db/schema.sql' }, dir);
    const result = await commandBaseline(config, { keepSince: ['20990101_000001__b.sql'] });
    expect(result.success).toBe(true);
    expect(result.squashedFiles).toEqual(['20990101_000000__a.sql']);
    const schema = await readFile(join(dir, 'db', 'schema.sql'), 'utf-8');
    expect(schema.split('\n')[0]).toBe('-- migraguard:baseline-history');
    expect(schema).toContain('-- 20990101_000000__a.sql checksum=');
    expect(schema).toContain('CREATE TABLE t (id int);');
  });
});
