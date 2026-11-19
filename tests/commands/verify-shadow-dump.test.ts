import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';

const dumpFiles: Array<{ path: string; mode: number; content: string }> = [];

vi.mock('pg', () => {
  class Client {
    async connect() {}
    async query() { return { rows: [] }; }
    async end() {}
  }
  return { default: { Client } };
});

vi.mock('../../src/db.js', () => ({
  createDb: () => ({ connect: async () => { throw new Error('no db'); }, close: async () => {} }),
  safeGetAllRecords: async () => [],
}));

vi.mock('../../src/exec.js', () => ({
  runCapturing: vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'pg_dump') {
      return { stdout: 'CREATE TABLE secret_probe (v text);\nCOPY secret_probe (v) FROM stdin;\ndummy-marker-0001\n\\.\n', stderr: '' };
    }
    const f = args.indexOf('-f');
    if (cmd === 'psql' && f >= 0 && args[f + 1].includes('migraguard-dump-')) {
      const path = args[f + 1];
      dumpFiles.push({ path, mode: (await stat(path)).mode & 0o777, content: await readFile(path, 'utf-8') });
    }
    return { stdout: '', stderr: '' };
  }),
}));

const { commandVerify } = await import('../../src/commands/verify.js');

describe('verify — copy of the source database', () => {
  let dir: string;

  beforeEach(async () => {
    dumpFiles.length = 0;
    dir = await mkdtemp(join(tmpdir(), 'migraguard-verify-'));
    await mkdir(join(dir, 'db', 'migrations'), { recursive: true });
    await writeFile(join(dir, 'db', 'migrations', '20990101_000000__t.sql'), 'CREATE TABLE IF NOT EXISTS probe_t (id int);');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the dump readable by its owner only while psql restores it', async () => {
    const config = buildConfig({ migrationsDir: 'db/migrations' }, dir);
    await commandVerify(config);
    expect(dumpFiles).toHaveLength(1);
    expect(dumpFiles[0].content).toContain('dummy-marker-0001');
    expect(dumpFiles[0].mode & 0o077).toBe(0);
  });
});
