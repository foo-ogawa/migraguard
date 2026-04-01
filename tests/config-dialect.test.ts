import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildConfig } from '../src/config.js';

describe('config dialect-aware defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('postgresql (default)', () => {
    it('uses PostgreSQL connection defaults', () => {
      const config = buildConfig({}, '/tmp');
      expect(config.dialect).toBe('postgresql');
      expect(config.connection.host).toBe('localhost');
      expect(config.connection.port).toBe(5432);
      expect(config.connection.database).toBe('postgres');
      expect(config.connection.user).toBe('postgres');
    });

    it('applies PG env overrides', () => {
      vi.stubEnv('PGHOST', 'pg-server');
      vi.stubEnv('PGPORT', '15432');
      vi.stubEnv('PGDATABASE', 'mydb');
      vi.stubEnv('PGUSER', 'myuser');
      vi.stubEnv('PGPASSWORD', 'secret');

      const config = buildConfig({}, '/tmp');
      expect(config.connection.host).toBe('pg-server');
      expect(config.connection.port).toBe(15432);
      expect(config.connection.database).toBe('mydb');
      expect(config.connection.user).toBe('myuser');
      expect(config.connection.password).toBe('secret');
    });
  });

  describe('mysql', () => {
    it('uses MySQL connection defaults', () => {
      const config = buildConfig({ dialect: 'mysql' }, '/tmp');
      expect(config.dialect).toBe('mysql');
      expect(config.connection.host).toBe('localhost');
      expect(config.connection.port).toBe(3306);
      expect(config.connection.database).toBe('mysql');
      expect(config.connection.user).toBe('root');
    });

    it('applies MySQL env overrides', () => {
      vi.stubEnv('MYSQL_HOST', 'mysql-server');
      vi.stubEnv('MYSQL_TCP_PORT', '13306');
      vi.stubEnv('MYSQL_DATABASE', 'testdb');
      vi.stubEnv('MYSQL_USER', 'admin');
      vi.stubEnv('MYSQL_PWD', 'pass');

      const config = buildConfig({ dialect: 'mysql' }, '/tmp');
      expect(config.connection.host).toBe('mysql-server');
      expect(config.connection.port).toBe(13306);
      expect(config.connection.database).toBe('testdb');
      expect(config.connection.user).toBe('admin');
      expect(config.connection.password).toBe('pass');
    });

    it('does not pick up PG env vars for mysql dialect', () => {
      vi.stubEnv('PGHOST', 'pg-server');
      vi.stubEnv('PGPORT', '15432');

      const config = buildConfig({ dialect: 'mysql' }, '/tmp');
      expect(config.connection.host).toBe('localhost');
      expect(config.connection.port).toBe(3306);
    });
  });

  describe('sqlite', () => {
    it('uses SQLite connection defaults', () => {
      const config = buildConfig({ dialect: 'sqlite' }, '/tmp');
      expect(config.dialect).toBe('sqlite');
      expect(config.connection.database).toBe('./database.sqlite3');
      expect(config.connection.host).toBe('');
      expect(config.connection.port).toBe(0);
    });

    it('applies SQLITE_DATABASE env override', () => {
      vi.stubEnv('SQLITE_DATABASE', '/data/app.db');

      const config = buildConfig({ dialect: 'sqlite' }, '/tmp');
      expect(config.connection.database).toBe('/data/app.db');
    });

    it('allows overriding database via config', () => {
      const config = buildConfig({
        dialect: 'sqlite',
        connection: { database: './test.db' },
      }, '/tmp');
      expect(config.connection.database).toBe('./test.db');
    });
  });
});
