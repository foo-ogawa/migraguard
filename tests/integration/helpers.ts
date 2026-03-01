import pg from 'pg';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../../src/config.js';
import { saveMetadata } from '../../src/metadata.js';
import type { MigraguardConfig, RawConfig } from '../../src/config.js';
import type { MetadataJson } from '../../src/metadata.js';

const { Client } = pg;

export const TEST_CONNECTION = {
  host: 'localhost',
  port: 15432,
  database: 'migraguard_test',
  user: 'migraguard_test',
  password: 'migraguard_test',
};

export const PG_DUMP_COMMAND = [
  'docker', 'exec',
  '-e', `PGPASSWORD=${TEST_CONNECTION.password}`,
  'migraguard-postgres-1',
  'pg_dump',
  '-h', 'localhost',
  '-U', TEST_CONNECTION.user,
  '-d', TEST_CONNECTION.database,
];

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
      pgDumpCommand: PG_DUMP_COMMAND,
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
