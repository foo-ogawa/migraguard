import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { commandDeps } from '../../src/commands/deps.js';

describe('commands/deps', () => {
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
  }

  it('returns empty graph when no files', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    const config = makeConfig();
    const result = await commandDeps(config);
    expect(result.graph.files).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('detects dependency between FK referencing tables', async () => {
    await setupMigration(
      '20260301_100000__create_users.sql',
      'CREATE TABLE users (id INT PRIMARY KEY);',
    );
    await setupMigration(
      '20260302_100000__create_posts.sql',
      'CREATE TABLE posts (id INT, user_id INT REFERENCES users(id));',
    );

    const config = makeConfig();
    const result = await commandDeps(config);

    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0].from).toBe('20260302_100000__create_posts.sql');
    expect(result.graph.edges[0].to).toBe('20260301_100000__create_users.sql');
  });

  it('identifies independent files as separate leaves', async () => {
    await setupMigration(
      '20260301_100000__create_users.sql',
      'CREATE TABLE users (id INT PRIMARY KEY);',
    );
    await setupMigration(
      '20260302_100000__create_orders.sql',
      'CREATE TABLE orders (id INT PRIMARY KEY);',
    );

    const config = makeConfig();
    const result = await commandDeps(config);

    expect(result.graph.edges).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('reports ok=true when no cycles', async () => {
    await setupMigration('20260301_100000__a.sql', 'CREATE TABLE a (id INT);');
    const config = makeConfig();
    const result = await commandDeps(config);
    expect(result.ok).toBe(true);
    expect(result.cycles).toEqual([]);
  });
});
