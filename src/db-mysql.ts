import type { MigraguardConfig } from './config.js';
import type { MigraguardDbAdapter, MigrationRecord, MigrationStatus, InsertRecordOptions } from './db.js';
import type { Phase } from './naming.js';
import type { MigrationClass } from './scanner.js';

const ADVISORY_LOCK_KEY = 'migraguard-apply';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    file_name       VARCHAR(256) NOT NULL,
    checksum        VARCHAR(64)  NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'applied',
    applied_at      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    resolved_at     TIMESTAMP(6) NULL,
    migration_class VARCHAR(16)  DEFAULT 'safe',
    phase           VARCHAR(16)  NULL,
    group_name      VARCHAR(256) NULL
) ENGINE=InnoDB;
`;

interface MysqlConnection {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
}

interface MysqlModule {
  createConnection(config: Record<string, unknown>): Promise<MysqlConnection>;
}

export class MigraguardDbMysql implements MigraguardDbAdapter {
  private config: MigraguardConfig;
  private connection: MysqlConnection | null = null;

  constructor(config: MigraguardConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    let mysql: MysqlModule;
    try {
      const id = 'mysql2/promise';
      const mod = await import(/* @vite-ignore */ id);
      mysql = mod.default as unknown as MysqlModule;
    } catch {
      throw new Error(
        'mysql2 is required for MySQL dialect. Install it: npm install mysql2',
      );
    }
    this.connection = await mysql.createConnection({
      host: this.config.connection.host,
      port: this.config.connection.port,
      database: this.config.connection.database,
      user: this.config.connection.user,
      password: this.config.connection.password,
    });
  }

  async close(): Promise<void> {
    await this.connection?.end();
  }

  async ensureTable(): Promise<void> {
    await this.exec(CREATE_TABLE_SQL);
  }

  async acquireAdvisoryLock(): Promise<void> {
    await this.exec(`SELECT GET_LOCK(?, -1)`, [ADVISORY_LOCK_KEY]);
  }

  async releaseAdvisoryLock(): Promise<void> {
    await this.exec(`SELECT RELEASE_LOCK(?)`, [ADVISORY_LOCK_KEY]);
  }

  async getAllRecords(): Promise<MigrationRecord[]> {
    const rows = await this.queryRows(
      `SELECT file_name, checksum, status, applied_at, resolved_at,
              migration_class, phase, group_name
       FROM schema_migrations
       ORDER BY applied_at ASC`,
    );
    return rows.map(mapRow);
  }

  async getRecordsForFile(fileName: string): Promise<MigrationRecord[]> {
    const rows = await this.queryRows(
      `SELECT file_name, checksum, status, applied_at, resolved_at,
              migration_class, phase, group_name
       FROM schema_migrations
       WHERE file_name = ?
       ORDER BY applied_at ASC`,
      [fileName],
    );
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
      await this.exec(
        `INSERT INTO schema_migrations (file_name, checksum, status, resolved_at, migration_class, phase, group_name)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP(6), ?, ?, ?)`,
        [fileName, checksum, status, migrationClass, phase, groupName],
      );
    } else {
      await this.exec(
        `INSERT INTO schema_migrations (file_name, checksum, status, migration_class, phase, group_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [fileName, checksum, status, migrationClass, phase, groupName],
      );
    }
  }

  private conn(): MysqlConnection {
    if (!this.connection) throw new Error('Not connected');
    return this.connection;
  }

  private async exec(sql: string, values?: unknown[]): Promise<void> {
    await this.conn().execute(sql, values);
  }

  private async queryRows(sql: string, values?: unknown[]): Promise<Array<Record<string, unknown>>> {
    const [rows] = await this.conn().execute(sql, values);
    return rows as Array<Record<string, unknown>>;
  }
}

function mapRow(row: Record<string, unknown>): MigrationRecord {
  return {
    fileName: row['file_name'] as string,
    checksum: row['checksum'] as string,
    status: row['status'] as MigrationStatus,
    appliedAt: row['applied_at'] instanceof Date
      ? row['applied_at']
      : new Date(row['applied_at'] as string),
    resolvedAt: row['resolved_at']
      ? (row['resolved_at'] instanceof Date ? row['resolved_at'] : new Date(row['resolved_at'] as string))
      : null,
    migrationClass: (row['migration_class'] as MigrationClass | undefined) ?? 'safe',
    phase: (row['phase'] as Phase | null) ?? null,
    groupName: (row['group_name'] as string | null) ?? null,
  };
}
