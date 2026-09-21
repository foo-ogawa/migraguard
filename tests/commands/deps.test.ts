import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  // mockRestore() also clears the recorded calls, so read them before restoring.
  async function captureLog(run: () => Promise<unknown>): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await run();
      return log.mock.calls.map((c) => String(c[0])).join('\n');
    } finally {
      log.mockRestore();
    }
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

  it('depends a GRANT on the file creating the granted table', async () => {
    await setupMigration(
      '20260301_100000__create_parent.sql',
      'CREATE TABLE parent (id INT PRIMARY KEY);',
    );
    await setupMigration(
      '20260302_100000__grant_parent.sql',
      'GRANT SELECT ON parent TO reporting_role;',
    );

    const config = makeConfig();
    const result = await commandDeps(config);

    expect(result.graph.edges).toEqual([{
      from: '20260302_100000__grant_parent.sql',
      to: '20260301_100000__create_parent.sql',
      via: 'parent',
    }]);
  });

  it('depends a GRANT on the file creating the grantee role', async () => {
    await setupMigration(
      '20260301_100000__create_role.sql',
      'CREATE ROLE reporting_role NOLOGIN;',
    );
    await setupMigration(
      '20260302_100000__grant_parent.sql',
      'GRANT SELECT ON parent TO reporting_role;',
    );

    const config = makeConfig();
    const result = await commandDeps(config);

    expect(result.graph.edges).toEqual([{
      from: '20260302_100000__grant_parent.sql',
      to: '20260301_100000__create_role.sql',
      via: 'reporting_role',
    }]);
  });

  it('does not bind a role to a table of the same name', async () => {
    await setupMigration(
      '20260301_100000__create_table.sql',
      'CREATE TABLE reporting (id INT);',
    );
    await setupMigration(
      '20260302_100000__grant_role.sql',
      'GRANT reporting TO app_user;',
    );

    const config = makeConfig();
    const result = await commandDeps(config);

    expect(result.graph.edges).toEqual([]);
  });

  it('depends a GRANT wrapped in a DO block on the file creating the table', async () => {
    await setupMigration(
      '20260301_100000__create_parent.sql',
      'CREATE TABLE parent (id INT PRIMARY KEY);',
    );
    await setupMigration(
      '20260302_100000__wrapped_grant.sql',
      'DO $$ BEGIN GRANT SELECT ON parent TO reporting_role; END $$;',
    );

    const result = await commandDeps(makeConfig());

    expect(result.graph.edges).toEqual([{
      from: '20260302_100000__wrapped_grant.sql',
      to: '20260301_100000__create_parent.sql',
      via: 'parent',
    }]);
  });

  it('warns about files building SQL at run time inside a DO block', async () => {
    await setupMigration(
      '20260301_100000__wrapped.sql',
      "DO $$ BEGIN EXECUTE format('CREATE TABLE %I (id int)', 'dyn'); END $$;",
    );

    const output = await captureLog(() => commandDeps(makeConfig()));

    expect(output).toContain('DO $$ ... $$');
    expect(output).toContain('20260301_100000__wrapped.sql');
  });

  it('stays quiet for a DO block it can read', async () => {
    await setupMigration(
      '20260301_100000__wrapped.sql',
      'DO $$ BEGIN CREATE TABLE child (id INT); END $$;',
    );

    const output = await captureLog(() => commandDeps(makeConfig()));

    expect(output).not.toContain('DO $$ ... $$');
  });
});
