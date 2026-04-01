import type { MigraguardConfig } from './config.js';
import type { MigraguardDbAdapter, MigrationRecord, MigrationStatus, InsertRecordOptions } from './db.js';
import type { Phase } from './naming.js';
import type { MigrationClass } from './scanner.js';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name       TEXT    NOT NULL,
    checksum        TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'applied',
    applied_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at     TEXT,
    migration_class TEXT    DEFAULT 'safe',
    phase           TEXT,
    group_name      TEXT
);
`;

interface SqliteStatement {
  all(...params: unknown[]): Array<Record<string, unknown>>;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  pragma(pragma: string): unknown;
}

export class MigraguardDbSqlite implements MigraguardDbAdapter {
  private config: MigraguardConfig;
  private database: SqliteDatabase | null = null;

  constructor(config: MigraguardConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    let Database: new (filename: string) => SqliteDatabase;
    try {
      const id = 'better-sqlite3';
      const mod = await import(/* @vite-ignore */ id);
      Database = mod.default as unknown as new (filename: string) => SqliteDatabase;
    } catch {
      throw new Error(
        'better-sqlite3 is required for SQLite dialect. Install it: npm install better-sqlite3',
      );
    }
    this.database = new Database(this.config.connection.database);
    this.db().pragma('journal_mode = WAL');
  }

  async close(): Promise<void> {
    this.database?.close();
  }

  async ensureTable(): Promise<void> {
    this.db().exec(CREATE_TABLE_SQL);
  }

  async acquireAdvisoryLock(): Promise<void> {
    /* SQLite uses file-level locking; no advisory lock needed */
  }

  async releaseAdvisoryLock(): Promise<void> {
    /* no-op */
  }

  async getAllRecords(): Promise<MigrationRecord[]> {
    const rows = this.db().prepare(
      `SELECT file_name, checksum, status, applied_at, resolved_at,
              migration_class, phase, group_name
       FROM schema_migrations
       ORDER BY applied_at ASC`,
    ).all();
    return rows.map(mapRow);
  }

  async getRecordsForFile(fileName: string): Promise<MigrationRecord[]> {
    const rows = this.db().prepare(
      `SELECT file_name, checksum, status, applied_at, resolved_at,
              migration_class, phase, group_name
       FROM schema_migrations
       WHERE file_name = ?
       ORDER BY applied_at ASC`,
    ).all(fileName);
    return rows.map(mapRow);
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

    if (status === 'skipped') {
      this.db().prepare(
        `INSERT INTO schema_migrations (file_name, checksum, status, resolved_at, migration_class, phase, group_name)
         VALUES (?, ?, ?, datetime('now'), ?, ?, ?)`,
      ).run(fileName, checksum, status, migrationClass, phase, groupName);
    } else {
      this.db().prepare(
        `INSERT INTO schema_migrations (file_name, checksum, status, migration_class, phase, group_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(fileName, checksum, status, migrationClass, phase, groupName);
    }
  }

  private db(): SqliteDatabase {
    if (!this.database) throw new Error('Not connected');
    return this.database;
  }
}

function mapRow(row: Record<string, unknown>): MigrationRecord {
  return {
    fileName: row['file_name'] as string,
    checksum: row['checksum'] as string,
    status: row['status'] as MigrationStatus,
    appliedAt: new Date(row['applied_at'] as string),
    resolvedAt: row['resolved_at'] ? new Date(row['resolved_at'] as string) : null,
    migrationClass: (row['migration_class'] as MigrationClass | undefined) ?? 'safe',
    phase: (row['phase'] as Phase | null) ?? null,
    groupName: (row['group_name'] as string | null) ?? null,
  };
}
