import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { saveMetadata, loadMetadata } from '../../src/metadata.js';
import { commandSquash } from '../../src/commands/squash.js';

describe('commands/squash', () => {
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

  async function setupFiles(fileMap: Record<string, string>) {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    for (const [name, content] of Object.entries(fileMap)) {
      await writeFile(join(migDir, name), content);
    }
  }

  it('does nothing when no new files', async () => {
    const config = makeConfig();
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await saveMetadata(config, { migrations: [] });

    await commandSquash(config);
    // no error
  });

  it('does nothing when only one new file', async () => {
    await setupFiles({
      '20260301_120000__create_users.sql': 'CREATE TABLE users;',
    });
    const config = makeConfig();
    await saveMetadata(config, { migrations: [] });

    await commandSquash(config);

    const migDir = join(tempDir, 'db', 'migrations');
    const files = await readdir(migDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('20260301_120000__create_users.sql');
  });

  it('squashes multiple new files into one', async () => {
    await setupFiles({
      '20260301_120000__add_user_email.sql': 'ALTER TABLE users ADD COLUMN email VARCHAR(256);',
      '20260302_093000__add_email_index.sql': 'CREATE INDEX idx_users_email ON users (email);',
    });
    const config = makeConfig();
    await saveMetadata(config, { migrations: [] });

    await commandSquash(config);

    const migDir = join(tempDir, 'db', 'migrations');
    const files = await readdir(migDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('20260302_093000__add_user_email_and_add_email_index.sql');

    const content = await readFile(join(migDir, files[0]), 'utf-8');
    expect(content).toContain('ALTER TABLE users ADD COLUMN email VARCHAR(256);');
    expect(content).toContain('CREATE INDEX idx_users_email ON users (email);');
    expect(content).toContain('Source: 20260301_120000__add_user_email.sql');
    expect(content).toContain('Source: 20260302_093000__add_email_index.sql');
  });

  it('preserves already-recorded files and only squashes new ones', async () => {
    await setupFiles({
      '20260228_120000__create_users.sql': 'CREATE TABLE users;',
      '20260301_120000__add_email.sql': 'ALTER TABLE users ADD email;',
      '20260302_093000__add_index.sql': 'CREATE INDEX;',
    });

    const config = makeConfig();
    await saveMetadata(config, {
      migrations: [
        { file: '20260228_120000__create_users.sql', checksum: 'recorded' },
      ],
    });

    await commandSquash(config);

    const migDir = join(tempDir, 'db', 'migrations');
    const files = (await readdir(migDir)).sort();
    expect(files).toHaveLength(2);
    expect(files).toContain('20260228_120000__create_users.sql');
    expect(files.find((f) => f.includes('add_email_and_add_index'))).toBeDefined();
  });

  it('updates metadata.json with squashed file', async () => {
    await setupFiles({
      '20260301_120000__file_a.sql': 'A',
      '20260302_120000__file_b.sql': 'B',
    });

    const config = makeConfig();
    await saveMetadata(config, { migrations: [] });

    await commandSquash(config);

    const meta = await loadMetadata(config);
    expect(meta.migrations).toHaveLength(1);
    expect(meta.migrations[0].file).toContain('file_a_and_file_b');
    expect(meta.migrations[0].checksum).toHaveLength(64);
  });

  it('squashes three files correctly', async () => {
    await setupFiles({
      '20260301_100000__step1.sql': 'STEP 1;',
      '20260301_110000__step2.sql': 'STEP 2;',
      '20260301_120000__step3.sql': 'STEP 3;',
    });

    const config = makeConfig();
    await saveMetadata(config, { migrations: [] });

    await commandSquash(config);

    const migDir = join(tempDir, 'db', 'migrations');
    const files = await readdir(migDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('20260301_120000__step1_and_step2_and_step3.sql');

    const content = await readFile(join(migDir, files[0]), 'utf-8');
    expect(content).toContain('STEP 1;');
    expect(content).toContain('STEP 2;');
    expect(content).toContain('STEP 3;');
  });

  // --- DAG mode tests ---

  it('DAG: allows squash when new files are in same dependency chain', async () => {
    await setupFiles({
      '20260301_100000__create_users.sql': 'CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY);',
      '20260302_100000__add_email.sql': 'ALTER TABLE users ADD COLUMN email VARCHAR(256);',
      '20260303_100000__add_index.sql': 'CREATE INDEX IF NOT EXISTS idx ON users (email);',
    });

    const config = makeConfig();
    await saveMetadata(config, {
      model: 'dag',
      modelSince: '20260301_100000__create_users.sql',
      migrations: [],
    });

    await commandSquash(config);

    const migDir = join(tempDir, 'db', 'migrations');
    const files = await readdir(migDir);
    expect(files).toHaveLength(1);
  });

  it('DAG: rejects squash when new files are in independent branches', async () => {
    await setupFiles({
      '20260301_100000__create_users.sql': 'CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY);',
      '20260302_100000__create_orders.sql': 'CREATE TABLE IF NOT EXISTS orders (id INT PRIMARY KEY);',
    });

    const config = makeConfig();
    await saveMetadata(config, {
      model: 'dag',
      modelSince: '20260301_100000__create_users.sql',
      migrations: [],
    });

    await expect(commandSquash(config)).rejects.toThrow('independent branches');
  });
});
