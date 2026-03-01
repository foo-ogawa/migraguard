import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { saveMetadata } from '../../src/metadata.js';
import { commandEditable } from '../../src/commands/editable.js';

describe('commands/editable', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeConfig() {
    return buildConfig({
      migrationsDir: 'db/migrations',
      metadataFile: 'db/.migraguard/metadata.json',
    }, tempDir);
  }

  async function setupFiles(fileNames: string[]) {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    for (const name of fileNames) {
      await writeFile(join(migDir, name), 'SELECT 1;');
    }
  }

  it('returns empty when no files exist', async () => {
    const config = makeConfig();
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    const result = await commandEditable(config);
    expect(result.editableFiles).toEqual([]);
  });

  it('marks the latest file as editable when all are recorded', async () => {
    await setupFiles([
      '20260301_120000__create_users.sql',
      '20260302_120000__add_index.sql',
    ]);
    const config = makeConfig();
    await saveMetadata(config, {
      migrations: [
        { file: '20260301_120000__create_users.sql', checksum: 'aaa' },
        { file: '20260302_120000__add_index.sql', checksum: 'bbb' },
      ],
    });

    const result = await commandEditable(config);
    expect(result.editableFiles).toEqual(['20260302_120000__add_index.sql']);
  });

  it('marks new files as editable', async () => {
    await setupFiles([
      '20260301_120000__recorded.sql',
      '20260302_120000__new_file.sql',
    ]);
    const config = makeConfig();
    await saveMetadata(config, {
      migrations: [
        { file: '20260301_120000__recorded.sql', checksum: 'aaa' },
      ],
    });

    const result = await commandEditable(config);
    expect(result.editableFiles).toContain('20260302_120000__new_file.sql');
  });

  it('single file is always editable', async () => {
    await setupFiles(['20260301_120000__only_file.sql']);
    const config = makeConfig();
    await saveMetadata(config, { migrations: [] });

    const result = await commandEditable(config);
    expect(result.editableFiles).toEqual(['20260301_120000__only_file.sql']);
  });

  it('returns entries with reason', async () => {
    await setupFiles([
      '20260301_120000__recorded.sql',
      '20260302_120000__new_file.sql',
    ]);
    const config = makeConfig();
    await saveMetadata(config, {
      migrations: [
        { file: '20260301_120000__recorded.sql', checksum: 'aaa' },
      ],
    });

    const result = await commandEditable(config);
    expect(result.entries).toBeDefined();
    const latestEntry = result.entries.find(e => e.reason === 'latest');
    expect(latestEntry?.fileName).toBe('20260302_120000__new_file.sql');
  });

  it('gracefully handles DB connection failure (file-based only)', async () => {
    await setupFiles(['20260301_120000__test.sql']);
    const config = makeConfig();
    await saveMetadata(config, { migrations: [] });

    const result = await commandEditable(config);
    expect(result.editableFiles).toHaveLength(1);
    expect(result.entries.every(e => e.reason !== 'failed-retryable')).toBe(true);
  });
});
