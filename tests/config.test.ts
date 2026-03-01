import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildConfig,
  findConfigFile,
  loadConfig,
  resolveFromConfig,
  CONFIG_FILE_NAME,
} from '../src/config.js';
import type { RawConfig } from '../src/config.js';

describe('config', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    delete process.env['PGHOST'];
    delete process.env['PGPORT'];
    delete process.env['PGDATABASE'];
    delete process.env['PGUSER'];
    delete process.env['PGPASSWORD'];
  });

  describe('buildConfig', () => {
    it('returns defaults when raw config is empty', () => {
      const config = buildConfig({}, '/project');
      expect(config.migrationsDirs).toEqual(['db/migrations']);
      expect(config.schemaFile).toBe('db/schema.sql');
      expect(config.metadataFile).toBe('db/.migraguard/metadata.json');
      expect(config.naming.pattern).toBe('{timestamp}__{description}.sql');
      expect(config.naming.timestamp).toBe('YYYYMMDD_HHMMSS');
      expect(config.naming.prefix).toBe('');
      expect(config.naming.sortKey).toBe('timestamp');
      expect(config.connection.host).toBe('localhost');
      expect(config.connection.port).toBe(5432);
      expect(config.connection.database).toBe('postgres');
      expect(config.connection.user).toBe('postgres');
      expect(config.dump.normalize).toBe(true);
      expect(config.dump.excludeOwners).toBe(true);
      expect(config.dump.excludePrivileges).toBe(true);
      expect(config.lint.squawk).toBe(true);
      expect(config.configDir).toBe('/project');
    });

    it('merges partial raw config with defaults', () => {
      const raw: RawConfig = {
        migrationsDir: 'custom/migrations',
        naming: { prefix: 'auth' },
        connection: { database: 'myapp', port: 5433 },
      };
      const config = buildConfig(raw, '/project');
      expect(config.migrationsDirs).toEqual(['custom/migrations']);
      expect(config.schemaFile).toBe('db/schema.sql');
      expect(config.naming.prefix).toBe('auth');
      expect(config.naming.pattern).toBe('{timestamp}__{description}.sql');
      expect(config.connection.database).toBe('myapp');
      expect(config.connection.port).toBe(5433);
      expect(config.connection.host).toBe('localhost');
    });

    it('applies environment variable overrides', () => {
      process.env['PGHOST'] = 'db.example.com';
      process.env['PGPORT'] = '5434';
      process.env['PGDATABASE'] = 'prod_db';
      process.env['PGUSER'] = 'admin';
      process.env['PGPASSWORD'] = 'secret';

      const config = buildConfig({}, '/project');
      expect(config.connection.host).toBe('db.example.com');
      expect(config.connection.port).toBe(5434);
      expect(config.connection.database).toBe('prod_db');
      expect(config.connection.user).toBe('admin');
      expect(config.connection.password).toBe('secret');
    });

    it('env vars override config file values', () => {
      process.env['PGHOST'] = 'override-host';

      const raw: RawConfig = {
        connection: { host: 'config-host', database: 'mydb' },
      };
      const config = buildConfig(raw, '/project');
      expect(config.connection.host).toBe('override-host');
      expect(config.connection.database).toBe('mydb');
    });

    it('accepts migrationsDirs array', () => {
      const raw: RawConfig = {
        migrationsDirs: ['db/migrations', 'services/auth/migrations'],
      };
      const config = buildConfig(raw, '/project');
      expect(config.migrationsDirs).toEqual(['db/migrations', 'services/auth/migrations']);
    });

    it('migrationsDirs takes priority over migrationsDir', () => {
      const raw: RawConfig = {
        migrationsDir: 'single',
        migrationsDirs: ['multi1', 'multi2'],
      };
      const config = buildConfig(raw, '/project');
      expect(config.migrationsDirs).toEqual(['multi1', 'multi2']);
    });
  });

  describe('findConfigFile', () => {
    it('finds config file in the given directory', async () => {
      const configPath = join(tempDir, CONFIG_FILE_NAME);
      await writeFile(configPath, '{}');

      const found = findConfigFile(tempDir);
      expect(found).toBe(configPath);
    });

    it('finds config file in a parent directory', async () => {
      const configPath = join(tempDir, CONFIG_FILE_NAME);
      await writeFile(configPath, '{}');

      const subDir = join(tempDir, 'sub', 'deep');
      await mkdir(subDir, { recursive: true });

      const found = findConfigFile(subDir);
      expect(found).toBe(configPath);
    });

    it('returns undefined when no config file exists', () => {
      const found = findConfigFile(tempDir);
      expect(found).toBeUndefined();
    });
  });

  describe('loadConfig', () => {
    it('loads config from a JSON file', async () => {
      const raw: RawConfig = {
        migrationsDir: 'sql/migrations',
        connection: { database: 'testdb' },
      };
      await writeFile(join(tempDir, CONFIG_FILE_NAME), JSON.stringify(raw));

      const config = await loadConfig(tempDir);
      expect(config.migrationsDirs).toEqual(['sql/migrations']);
      expect(config.connection.database).toBe('testdb');
      expect(config.configDir).toBe(tempDir);
    });

    it('returns defaults when no config file found', async () => {
      const config = await loadConfig(tempDir);
      expect(config.migrationsDirs).toEqual(['db/migrations']);
      expect(config.configDir).toBe(tempDir);
    });

    it('throws on invalid JSON', async () => {
      await writeFile(join(tempDir, CONFIG_FILE_NAME), '{ invalid json }');
      await expect(loadConfig(tempDir)).rejects.toThrow('Invalid JSON');
    });
  });

  describe('resolveFromConfig', () => {
    it('resolves relative path from configDir', () => {
      const config = buildConfig({}, '/project');
      expect(resolveFromConfig(config, 'db/migrations')).toBe('/project/db/migrations');
    });

    it('preserves absolute paths', () => {
      const config = buildConfig({}, '/project');
      expect(resolveFromConfig(config, '/absolute/path')).toBe('/absolute/path');
    });
  });
});
