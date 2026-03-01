import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { saveMetadata } from '../../src/metadata.js';
import { checksumString } from '../../src/checksum.js';
import { commandCheck } from '../../src/commands/check.js';
import type { MetadataJson } from '../../src/metadata.js';

describe('commands/check', () => {
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

  async function setupMigration(fileName: string, content: string) {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, fileName), content);
    return checksumString(content);
  }

  async function setupMetadata(metadata: MetadataJson) {
    const config = makeConfig();
    await saveMetadata(config, metadata);
  }

  it('passes when no files and no metadata', async () => {
    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(true);
  });

  it('passes with one new file (no metadata entries)', async () => {
    await setupMigration('20260301_120000__create_users.sql', 'CREATE TABLE users;');
    await setupMetadata({ migrations: [] });

    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(true);
  });

  it('passes with matching checksums', async () => {
    const content = 'CREATE TABLE users (id SERIAL);';
    const checksum = await setupMigration('20260301_120000__create_users.sql', content);
    await setupMetadata({
      migrations: [{ file: '20260301_120000__create_users.sql', checksum }],
    });

    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(true);
  });

  it('fails when multiple new files exist', async () => {
    await setupMigration('20260301_120000__file_a.sql', 'A');
    await setupMigration('20260302_120000__file_b.sql', 'B');
    await setupMetadata({ migrations: [] });

    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('2 new files'))).toBe(true);
  });

  it('fails when a non-latest recorded file has checksum mismatch', async () => {
    const contentA = 'CREATE TABLE users;';
    const checksumA = checksumString(contentA);
    const contentB = 'CREATE TABLE orders;';
    const checksumB = await setupMigration('20260302_120000__create_orders.sql', contentB);

    // Write file A with different content than metadata records
    await setupMigration('20260301_120000__create_users.sql', 'MODIFIED CONTENT');

    await setupMetadata({
      migrations: [
        { file: '20260301_120000__create_users.sql', checksum: checksumA },
        { file: '20260302_120000__create_orders.sql', checksum: checksumB },
      ],
    });

    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Checksum mismatch'))).toBe(true);
  });

  it('allows latest recorded file to have checksum change', async () => {
    const contentA = 'CREATE TABLE users;';
    const checksumA = await setupMigration('20260301_120000__create_users.sql', contentA);

    // Latest file has different content
    await setupMigration('20260302_120000__create_orders.sql', 'MODIFIED CONTENT');

    await setupMetadata({
      migrations: [
        { file: '20260301_120000__create_users.sql', checksum: checksumA },
        { file: '20260302_120000__create_orders.sql', checksum: 'old_checksum' },
      ],
    });

    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(true);
  });

  it('fails when a new file is inserted mid-sequence', async () => {
    const contentA = 'CREATE TABLE users;';
    const checksumA = await setupMigration('20260301_120000__create_users.sql', contentA);
    const contentB = 'CREATE TABLE orders;';
    const checksumB = await setupMigration('20260303_120000__create_orders.sql', contentB);

    // Insert a new file between the two recorded files
    await setupMigration('20260302_120000__mid_insert.sql', 'INSERT');

    await setupMetadata({
      migrations: [
        { file: '20260301_120000__create_users.sql', checksum: checksumA },
        { file: '20260303_120000__create_orders.sql', checksum: checksumB },
      ],
    });

    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Mid-sequence insertion'))).toBe(true);
  });

  it('fails when a metadata-recorded file is missing from disk', async () => {
    await setupMetadata({
      migrations: [
        { file: '20260301_120000__missing_file.sql', checksum: 'abc' },
      ],
    });

    // migrations dir exists but the file does not
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });

    const config = makeConfig();
    const result = await commandCheck(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('missing from disk'))).toBe(true);
  });
});
