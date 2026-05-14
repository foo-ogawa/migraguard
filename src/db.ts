import pg from 'pg';
import type { MigraguardConfig } from './config.js';
import type { Phase } from './naming.js';
import type { MigrationClass } from './scanner.js';
import { MigraguardDbMysql } from './db-mysql.js';
import { MigraguardDbSqlite } from './db-sqlite.js';

const { Client } = pg;

const ADVISORY_LOCK_KEY = 'migraguard-apply';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          BIGSERIAL    PRIMARY KEY,
    file_name   VARCHAR(256) NOT NULL,
    checksum    VARCHAR(64)  NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'applied',
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
);
`;

const ALTER_TABLE_SQL = `
ALTER TABLE schema_migrations
  ADD COLUMN IF NOT EXISTS migration_class VARCHAR(16) DEFAULT 'safe',
  ADD COLUMN IF NOT EXISTS phase VARCHAR(16),
  ADD COLUMN IF NOT EXISTS group_name VARCHAR(256),
  ADD COLUMN IF NOT EXISTS tag VARCHAR(256);
`;

export type MigrationStatus = 'applied' | 'failed' | 'skipped' | 'running';

export interface MigrationRecord {
  fileName: string;
  checksum: string;
  status: MigrationStatus;
  appliedAt: Date;
  resolvedAt: Date | null;
  migrationClass: MigrationClass;
  phase: Phase | null;
  groupName: string | null;
  tag: string | null;
}

export interface InsertRecordOptions {
  migrationClass?: MigrationClass;
  phase?: Phase;
  groupName?: string;
  tag?: string;
}

export interface MigraguardDbAdapter {
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureTable(): Promise<void>;
  acquireAdvisoryLock(): Promise<void>;
  releaseAdvisoryLock(): Promise<void>;
  getAllRecords(): Promise<MigrationRecord[]>;
  getRecordsForFile(fileName: string): Promise<MigrationRecord[]>;
  insertRecord(fileName: string, checksum: string, status: MigrationStatus, options?: InsertRecordOptions): Promise<void>;
}

export function createDb(config: MigraguardConfig): MigraguardDbAdapter {
  switch (config.dialect) {
    case 'mysql': return new MigraguardDbMysql(config);
    case 'sqlite': return new MigraguardDbSqlite(config);
    default: return new MigraguardDb(config);
  }
}

const CONNECTION_TIMEOUT_MS = 10_000;
const SESSION_STATEMENT_TIMEOUT_MS = 30_000;
const DDL_LOCK_TIMEOUT = '5s';
const DDL_STATEMENT_TIMEOUT = '10s';

const REQUIRED_COLUMNS = ['migration_class', 'phase', 'group_name', 'tag'];

export class MigraguardDb implements MigraguardDbAdapter {
  private client: pg.Client;

  constructor(config: MigraguardConfig) {
    this.client = new Client({
      host: config.connection.host,
      port: config.connection.port,
      database: config.connection.database,
      user: config.connection.user,
      password: config.connection.password,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.client.query(`SET statement_timeout = ${SESSION_STATEMENT_TIMEOUT_MS}`);
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async ensureTable(): Promise<void> {
    if (await this.tableHasAllColumns()) return;

    await this.client.query(`SET lock_timeout = '${DDL_LOCK_TIMEOUT}'`);
    await this.client.query(`SET statement_timeout = '${DDL_STATEMENT_TIMEOUT}'`);
    try {
      await this.client.query(CREATE_TABLE_SQL);
      await this.client.query(ALTER_TABLE_SQL);
    } finally {
      await this.client.query('RESET lock_timeout');
      await this.client.query(`SET statement_timeout = ${SESSION_STATEMENT_TIMEOUT_MS}`);
    }
  }

  private async tableHasAllColumns(): Promise<boolean> {
    const result = await this.client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'schema_migrations'
         AND table_schema = current_schema()`,
    );
    if (result.rows.length === 0) return false;
    const existing = new Set(result.rows.map((r: Record<string, unknown>) => r['column_name']));
    return REQUIRED_COLUMNS.every((c) => existing.has(c));
  }

  async acquireAdvisoryLock(): Promise<void> {
    await this.client.query(`SELECT pg_advisory_lock(hashtext($1))`, [ADVISORY_LOCK_KEY]);
  }

  async releaseAdvisoryLock(): Promise<void> {
    await this.client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_LOCK_KEY]);
  }

  async getAllRecords(): Promise<MigrationRecord[]> {
    const result = await this.client.query(
      `SELECT file_name, checksum, status, applied_at, resolved_at,
              migration_class, phase, group_name, tag
       FROM schema_migrations
       ORDER BY applied_at ASC`,
    );
    return result.rows.map(mapRow);
  }

  async getRecordsForFile(fileName: string): Promise<MigrationRecord[]> {
    const result = await this.client.query(
      `SELECT file_name, checksum, status, applied_at, resolved_at,
              migration_class, phase, group_name, tag
       FROM schema_migrations
       WHERE file_name = $1
       ORDER BY applied_at ASC`,
      [fileName],
    );
    return result.rows.map(mapRow);
  }

  async insertRecord(
    fileName: string,
    checksum: string,
    status: MigrationStatus,
    options?: InsertRecordOptions,
  ): Promise<void> {
    const migrationClass = options?.migrationClass ?? 'safe';
    const phase = options?.phase ?? null;
    const groupName = options?.groupName ?? null;
    const tag = options?.tag ?? null;

    if (status === 'skipped') {
      await this.client.query(
        `INSERT INTO schema_migrations (file_name, checksum, status, resolved_at, migration_class, phase, group_name, tag)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7)`,
        [fileName, checksum, status, migrationClass, phase, groupName, tag],
      );
    } else {
      await this.client.query(
        `INSERT INTO schema_migrations (file_name, checksum, status, migration_class, phase, group_name, tag)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [fileName, checksum, status, migrationClass, phase, groupName, tag],
      );
    }
  }

  getClient(): pg.Client {
    return this.client;
  }
}

function mapRow(row: Record<string, unknown>): MigrationRecord {
  return {
    fileName: row['file_name'] as string,
    checksum: row['checksum'] as string,
    status: row['status'] as MigrationStatus,
    appliedAt: row['applied_at'] as Date,
    resolvedAt: (row['resolved_at'] as Date | null) ?? null,
    migrationClass: (row['migration_class'] as MigrationClass | undefined) ?? 'safe',
    phase: (row['phase'] as Phase | null) ?? null,
    groupName: (row['group_name'] as string | null) ?? null,
    tag: (row['tag'] as string | null) ?? null,
  };
}
