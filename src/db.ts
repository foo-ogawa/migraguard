import pg from 'pg';
import type { MigraguardConfig } from './config.js';

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

export interface MigrationRecord {
  fileName: string;
  checksum: string;
  status: 'applied' | 'failed' | 'skipped';
  appliedAt: Date;
  resolvedAt: Date | null;
}

export class MigraguardDb {
  private client: pg.Client;

  constructor(config: MigraguardConfig) {
    this.client = new Client({
      host: config.connection.host,
      port: config.connection.port,
      database: config.connection.database,
      user: config.connection.user,
      password: config.connection.password,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async ensureTable(): Promise<void> {
    await this.client.query(CREATE_TABLE_SQL);
  }

  async acquireAdvisoryLock(): Promise<void> {
    await this.client.query(`SELECT pg_advisory_lock(hashtext($1))`, [ADVISORY_LOCK_KEY]);
  }

  async releaseAdvisoryLock(): Promise<void> {
    await this.client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [ADVISORY_LOCK_KEY]);
  }

  async getAllRecords(): Promise<MigrationRecord[]> {
    const result = await this.client.query(
      `SELECT file_name, checksum, status, applied_at, resolved_at
       FROM schema_migrations
       ORDER BY applied_at ASC`,
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      fileName: row['file_name'] as string,
      checksum: row['checksum'] as string,
      status: row['status'] as 'applied' | 'failed' | 'skipped',
      appliedAt: row['applied_at'] as Date,
      resolvedAt: (row['resolved_at'] as Date | null) ?? null,
    }));
  }

  async getRecordsForFile(fileName: string): Promise<MigrationRecord[]> {
    const result = await this.client.query(
      `SELECT file_name, checksum, status, applied_at, resolved_at
       FROM schema_migrations
       WHERE file_name = $1
       ORDER BY applied_at ASC`,
      [fileName],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      fileName: row['file_name'] as string,
      checksum: row['checksum'] as string,
      status: row['status'] as 'applied' | 'failed' | 'skipped',
      appliedAt: row['applied_at'] as Date,
      resolvedAt: (row['resolved_at'] as Date | null) ?? null,
    }));
  }

  async insertRecord(
    fileName: string,
    checksum: string,
    status: 'applied' | 'failed' | 'skipped',
  ): Promise<void> {
    if (status === 'skipped') {
      await this.client.query(
        `INSERT INTO schema_migrations (file_name, checksum, status, resolved_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [fileName, checksum, status],
      );
    } else {
      await this.client.query(
        `INSERT INTO schema_migrations (file_name, checksum, status)
         VALUES ($1, $2, $3)`,
        [fileName, checksum, status],
      );
    }
  }

  getClient(): pg.Client {
    return this.client;
  }
}
