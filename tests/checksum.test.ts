import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksumString, checksumFile } from '../src/checksum.js';

describe('checksum', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('checksumString', () => {
    it('returns a 64-character hex string (SHA-256)', () => {
      const hash = checksumString('hello');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns consistent results for same input', () => {
      const a = checksumString('CREATE TABLE users (id SERIAL);');
      const b = checksumString('CREATE TABLE users (id SERIAL);');
      expect(a).toBe(b);
    });

    it('returns different results for different input', () => {
      const a = checksumString('CREATE TABLE users (id SERIAL);');
      const b = checksumString('CREATE TABLE orders (id SERIAL);');
      expect(a).not.toBe(b);
    });

    it('handles empty string', () => {
      const hash = checksumString('');
      expect(hash).toHaveLength(64);
    });

    it('handles multi-line SQL', () => {
      const sql = `CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(256) NOT NULL
);`;
      const hash = checksumString(sql);
      expect(hash).toHaveLength(64);
    });
  });

  describe('checksumFile', () => {
    it('computes checksum from file content', async () => {
      const content = 'CREATE TABLE users (id SERIAL);';
      const filePath = join(tempDir, 'test.sql');
      await writeFile(filePath, content);

      const fileHash = await checksumFile(filePath);
      const stringHash = checksumString(content);
      expect(fileHash).toBe(stringHash);
    });

    it('throws for non-existent file', async () => {
      await expect(checksumFile(join(tempDir, 'nonexistent.sql'))).rejects.toThrow();
    });
  });
});
