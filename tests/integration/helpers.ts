import pg from 'pg';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { saveMetadata } from '../../src/metadata.js';
import type { MigraguardConfig, RawConfig } from '../../src/config.js';
import type { MetadataJson } from '../../src/metadata.js';

const { Client } = pg;

/**
 * The database comes from DATABASE_URL, which the `test-integration` service in
 * docker-compose.test.yml sets. That service is the one place the suite runs.
 */
function connectionFromEnv(): { host: string; port: number; database: string; user: string; password: string } {
  const raw = process.env['DATABASE_URL'];
  if (!raw) {
    throw new Error('DATABASE_URL is not set. Run the suite through the test-integration service in docker-compose.test.yml.');
  }
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export const TEST_CONNECTION = connectionFromEnv();

export async function resetTestDb(): Promise<void> {
  const client = new Client(TEST_CONNECTION);
  await client.connect();
  try {
    await client.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
    const result = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    for (const row of result.rows) {
      const name = (row as Record<string, string>)['tablename'];
      await client.query(`DROP TABLE IF EXISTS "${name}" CASCADE`);
    }
  } finally {
    await client.end();
  }
}

export async function queryTestDb(sql: string): Promise<pg.QueryResult> {
  const client = new Client(TEST_CONNECTION);
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

export interface TestProject {
  tempDir: string;
  config: MigraguardConfig;
  migrationsDir: string;
}

export async function createTestProject(rawOverrides?: Partial<RawConfig>): Promise<TestProject> {
  const tempDir = await mkdtemp(join(tmpdir(), 'migraguard-integ-'));
  const migrationsDir = join(tempDir, 'db', 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  const raw: RawConfig = {
    migrationsDir: 'db/migrations',
    metadataFile: 'db/.migraguard/metadata.json',
    schemaFile: 'db/schema.sql',
    connection: TEST_CONNECTION,
    dump: {
      normalize: true,
      excludeOwners: true,
      excludePrivileges: true,
    },
    ...rawOverrides,
  };
  const config = buildConfig(raw, tempDir);
  await saveMetadata(config, { migrations: [] });

  return { tempDir, config, migrationsDir };
}

export async function writeMigration(project: TestProject, fileName: string, sql: string): Promise<void> {
  await writeFile(join(project.migrationsDir, fileName), sql);
}

export async function updateMetadata(project: TestProject, metadata: MetadataJson): Promise<void> {
  await saveMetadata(project.config, metadata);
}

export async function cleanupTestProject(project: TestProject): Promise<void> {
  await rm(project.tempDir, { recursive: true, force: true });
}
