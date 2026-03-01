import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { buildConfig } from '../src/config.js';
import {
  loadMetadata,
  saveMetadata,
  findEntry,
  addEntry,
  removeEntry,
  updateEntry,
} from '../src/metadata.js';
import type { MetadataJson } from '../src/metadata.js';

describe('metadata', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeConfig(metadataFile = 'db/.migraguard/metadata.json') {
    return buildConfig({ metadataFile }, tempDir);
  }

  describe('loadMetadata', () => {
    it('returns empty migrations when file does not exist', async () => {
      const config = makeConfig();
      const meta = await loadMetadata(config);
      expect(meta.migrations).toEqual([]);
    });

    it('loads valid metadata.json', async () => {
      const metaDir = join(tempDir, 'db', '.migraguard');
      await mkdir(metaDir, { recursive: true });
      const data: MetadataJson = {
        migrations: [
          { file: '20260301_120000__create_users.sql', checksum: 'aaa' },
          { file: '20260302_093000__add_index.sql', checksum: 'bbb' },
        ],
      };
      await writeFile(join(metaDir, 'metadata.json'), JSON.stringify(data));

      const config = makeConfig();
      const meta = await loadMetadata(config);
      expect(meta.migrations).toHaveLength(2);
      expect(meta.migrations[0].file).toBe('20260301_120000__create_users.sql');
    });

    it('throws on invalid JSON', async () => {
      const metaDir = join(tempDir, 'db', '.migraguard');
      await mkdir(metaDir, { recursive: true });
      await writeFile(join(metaDir, 'metadata.json'), '{ bad json }');

      const config = makeConfig();
      await expect(loadMetadata(config)).rejects.toThrow('Invalid JSON');
    });

    it('throws on invalid metadata format', async () => {
      const metaDir = join(tempDir, 'db', '.migraguard');
      await mkdir(metaDir, { recursive: true });
      await writeFile(join(metaDir, 'metadata.json'), '{"migrations": "not_array"}');

      const config = makeConfig();
      await expect(loadMetadata(config)).rejects.toThrow('Invalid metadata format');
    });
  });

  describe('saveMetadata', () => {
    it('creates directory and writes metadata.json', async () => {
      const config = makeConfig();
      const data: MetadataJson = {
        migrations: [{ file: 'test.sql', checksum: 'abc123' }],
      };
      await saveMetadata(config, data);

      const metaPath = join(tempDir, 'db', '.migraguard', 'metadata.json');
      expect(existsSync(metaPath)).toBe(true);

      const content = await readFile(metaPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.migrations).toHaveLength(1);
      expect(parsed.migrations[0].file).toBe('test.sql');
    });

    it('overwrites existing metadata.json', async () => {
      const config = makeConfig();
      await saveMetadata(config, { migrations: [{ file: 'a.sql', checksum: '111' }] });
      await saveMetadata(config, { migrations: [{ file: 'b.sql', checksum: '222' }] });

      const metaPath = join(tempDir, 'db', '.migraguard', 'metadata.json');
      const content = await readFile(metaPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.migrations).toHaveLength(1);
      expect(parsed.migrations[0].file).toBe('b.sql');
    });
  });

  describe('findEntry', () => {
    const meta: MetadataJson = {
      migrations: [
        { file: 'a.sql', checksum: '111' },
        { file: 'b.sql', checksum: '222' },
      ],
    };

    it('finds existing entry', () => {
      expect(findEntry(meta, 'a.sql')).toEqual({ file: 'a.sql', checksum: '111' });
    });

    it('returns undefined for non-existent entry', () => {
      expect(findEntry(meta, 'c.sql')).toBeUndefined();
    });
  });

  describe('addEntry', () => {
    it('appends entry to migrations', () => {
      const meta: MetadataJson = { migrations: [{ file: 'a.sql', checksum: '111' }] };
      const result = addEntry(meta, { file: 'b.sql', checksum: '222' });
      expect(result.migrations).toHaveLength(2);
      expect(result.migrations[1].file).toBe('b.sql');
    });

    it('does not mutate original', () => {
      const meta: MetadataJson = { migrations: [{ file: 'a.sql', checksum: '111' }] };
      addEntry(meta, { file: 'b.sql', checksum: '222' });
      expect(meta.migrations).toHaveLength(1);
    });
  });

  describe('removeEntry', () => {
    it('removes entry by file name', () => {
      const meta: MetadataJson = {
        migrations: [
          { file: 'a.sql', checksum: '111' },
          { file: 'b.sql', checksum: '222' },
        ],
      };
      const result = removeEntry(meta, 'a.sql');
      expect(result.migrations).toHaveLength(1);
      expect(result.migrations[0].file).toBe('b.sql');
    });
  });

  describe('updateEntry', () => {
    it('updates checksum for existing entry', () => {
      const meta: MetadataJson = {
        migrations: [{ file: 'a.sql', checksum: '111' }],
      };
      const result = updateEntry(meta, 'a.sql', '999');
      expect(result.migrations[0].checksum).toBe('999');
    });

    it('does not mutate original', () => {
      const meta: MetadataJson = {
        migrations: [{ file: 'a.sql', checksum: '111' }],
      };
      updateEntry(meta, 'a.sql', '999');
      expect(meta.migrations[0].checksum).toBe('111');
    });
  });
});
