import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';

let workflowData: unknown = {};

vi.mock('agent-contracts-runtime', () => ({
  executeWorkflow: vi.fn(async () => ({
    status: 'completed',
    steps: [{ outcome: { status: 'success', data: workflowData, raw: '{}' } }],
  })),
}));

const { commandImplement } = await import('../../src/commands/implement.js');
const { commandProposeExpandContract } = await import('../../src/commands/propose-expand-contract.js');

describe('files written from LLM output', () => {
  let dir: string;
  let migDir: string;
  let victim: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migraguard-llm-write-'));
    migDir = join(dir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    victim = join(dir, 'victim.txt');
    await writeFile(victim, 'ORIGINAL');
    await symlink(victim, join(migDir, '20990101_000000__x.sql'));
    await writeFile(join(migDir, '20990101_000002__existing.sql'), 'ORIGINAL-MIGRATION');
    await writeFile(join(migDir, '20990101_000001__a.sql'), 'ALTER TABLE t RENAME COLUMN a TO b;');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function config() {
    return buildConfig({ migrationsDir: 'db/migrations' }, dir);
  }

  it('implement does not write through a symlink in the output directory', async () => {
    workflowData = { migrations: [{ fileName: '20990101_000000__x.sql', sql: 'MARKER-IMPL', description: 'd' }] };
    await expect(commandImplement(config(), 'd', { output: join(dir, 'out.json') })).rejects.toThrow();
    expect(await readFile(victim, 'utf-8')).toBe('ORIGINAL');
    expect((await lstat(join(migDir, '20990101_000000__x.sql'))).isSymbolicLink()).toBe(true);
  });

  it('implement does not overwrite an existing migration', async () => {
    workflowData = { migrations: [{ fileName: '20990101_000002__existing.sql', sql: 'MARKER-IMPL', description: 'd' }] };
    await expect(commandImplement(config(), 'd', { output: join(dir, 'out.json') })).rejects.toThrow();
    expect(await readFile(join(migDir, '20990101_000002__existing.sql'), 'utf-8')).toBe('ORIGINAL-MIGRATION');
  });

  it('propose-expand-contract does not write through a symlink or overwrite an existing file', async () => {
    workflowData = {
      summary: 's', riskLevel: 'low', findings: [],
      recommendedActions: [
        { kind: 'edit_file', title: 't', target: 'x/20990101_000000__x.sql', command: 'MARKER-PROP' },
      ],
    };
    await expect(commandProposeExpandContract(config(), join(migDir, '20990101_000001__a.sql'), {
      outputDir: migDir, output: join(dir, 'out.json'),
    })).rejects.toThrow();
    expect(await readFile(victim, 'utf-8')).toBe('ORIGINAL');

    workflowData = {
      summary: 's', riskLevel: 'low', findings: [],
      recommendedActions: [
        { kind: 'edit_file', title: 't', target: '20990101_000002__existing.sql', command: 'MARKER-PROP' },
      ],
    };
    await expect(commandProposeExpandContract(config(), join(migDir, '20990101_000001__a.sql'), {
      outputDir: migDir, output: join(dir, 'out.json'),
    })).rejects.toThrow();
    expect(await readFile(join(migDir, '20990101_000002__existing.sql'), 'utf-8')).toBe('ORIGINAL-MIGRATION');
  });

  it('implement still creates a new migration file', async () => {
    workflowData = { migrations: [{ fileName: '20990101_000003__new.sql', sql: 'SELECT 1;', description: 'd' }] };
    await commandImplement(config(), 'd', { output: join(dir, 'out.json') });
    expect(await readFile(join(migDir, '20990101_000003__new.sql'), 'utf-8')).toBe('SELECT 1;');
  });
});
