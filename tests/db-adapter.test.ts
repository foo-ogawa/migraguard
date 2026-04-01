import { describe, it, expect } from 'vitest';
import { buildConfig } from '../src/config.js';
import { MigraguardDb, createDb } from '../src/db.js';
import { MigraguardDbMysql } from '../src/db-mysql.js';
import { MigraguardDbSqlite } from '../src/db-sqlite.js';

describe('createDb factory', () => {
  it('returns MigraguardDb for postgresql dialect', () => {
    const config = buildConfig({ dialect: 'postgresql' }, '/tmp');
    const db = createDb(config);
    expect(db).toBeInstanceOf(MigraguardDb);
  });

  it('returns MigraguardDb when dialect is omitted (default)', () => {
    const config = buildConfig({}, '/tmp');
    const db = createDb(config);
    expect(db).toBeInstanceOf(MigraguardDb);
  });

  it('returns MigraguardDbMysql for mysql dialect', () => {
    const config = buildConfig({ dialect: 'mysql' }, '/tmp');
    const db = createDb(config);
    expect(db).toBeInstanceOf(MigraguardDbMysql);
  });

  it('returns MigraguardDbSqlite for sqlite dialect', () => {
    const config = buildConfig({ dialect: 'sqlite' }, '/tmp');
    const db = createDb(config);
    expect(db).toBeInstanceOf(MigraguardDbSqlite);
  });
});

describe('MigraguardDbMysql', () => {
  it('stores config and starts without connection', () => {
    const config = buildConfig({ dialect: 'mysql' }, '/tmp');
    const db = new MigraguardDbMysql(config);
    expect(db).toBeDefined();
  });

  it('connect() throws helpful error when mysql2 is not installed', async () => {
    const config = buildConfig({ dialect: 'mysql' }, '/tmp');
    const db = new MigraguardDbMysql(config);
    await expect(db.connect()).rejects.toThrow('mysql2 is required');
  });
});

describe('MigraguardDbSqlite', () => {
  it('stores config and starts without connection', () => {
    const config = buildConfig({ dialect: 'sqlite' }, '/tmp');
    const db = new MigraguardDbSqlite(config);
    expect(db).toBeDefined();
  });

  it('connect() throws helpful error when better-sqlite3 is not installed', async () => {
    const config = buildConfig({ dialect: 'sqlite' }, '/tmp');
    const db = new MigraguardDbSqlite(config);
    await expect(db.connect()).rejects.toThrow('better-sqlite3 is required');
  });
});
