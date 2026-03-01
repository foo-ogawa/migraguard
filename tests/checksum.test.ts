import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checksumString, checksumFile, normalizeSQL } from '../src/checksum.js';

describe('normalizeSQL', () => {
  it('strips line comments', () => {
    const sql = "SELECT 1; -- this is a comment\nSELECT 2;";
    expect(normalizeSQL(sql)).toBe('SELECT 1; SELECT 2;');
  });

  it('strips block comments', () => {
    const sql = "SELECT /* inline */ 1;";
    expect(normalizeSQL(sql)).toBe('SELECT 1;');
  });

  it('strips nested block comments', () => {
    const sql = "SELECT /* outer /* inner */ still comment */ 1;";
    expect(normalizeSQL(sql)).toBe('SELECT 1;');
  });

  it('collapses whitespace', () => {
    const sql = "CREATE  TABLE   users  (\n  id   SERIAL\n);";
    expect(normalizeSQL(sql)).toBe('CREATE TABLE users ( id SERIAL );');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSQL('  SELECT 1;  \n')).toBe('SELECT 1;');
  });

  it('preserves single-quoted strings', () => {
    const sql = "INSERT INTO t VALUES ('hello -- world');";
    expect(normalizeSQL(sql)).toBe("INSERT INTO t VALUES ('hello -- world');");
  });

  it('preserves escaped quotes in single-quoted strings', () => {
    const sql = "SELECT 'it''s -- fine';";
    expect(normalizeSQL(sql)).toBe("SELECT 'it''s -- fine';");
  });

  it('preserves double-quoted identifiers', () => {
    const sql = 'SELECT "column -- name" FROM t;';
    expect(normalizeSQL(sql)).toBe('SELECT "column -- name" FROM t;');
  });

  it('preserves dollar-quoted strings', () => {
    const sql = "CREATE FUNCTION f() RETURNS void AS $$\n-- inside body\nBEGIN NULL; END;\n$$ LANGUAGE plpgsql;";
    expect(normalizeSQL(sql)).toBe("CREATE FUNCTION f() RETURNS void AS $$\n-- inside body\nBEGIN NULL; END;\n$$ LANGUAGE plpgsql;");
  });

  it('preserves tagged dollar-quoted strings', () => {
    const sql = "DO $body$\n/* block inside */\nBEGIN NULL; END;\n$body$;";
    expect(normalizeSQL(sql)).toBe("DO $body$\n/* block inside */\nBEGIN NULL; END;\n$body$;");
  });

  it('handles E-string escapes', () => {
    const sql = "SELECT E'line1\\nline2';";
    expect(normalizeSQL(sql)).toBe("SELECT E'line1\\nline2';");
  });

  it('handles E-string with escaped quote', () => {
    const sql = "SELECT E'it\\'s';";
    expect(normalizeSQL(sql)).toBe("SELECT E'it\\'s';");
  });

  it('strips migraguard directives (they are comments)', () => {
    const sql = "-- migraguard:depends-on 20260301__create_users.sql\nCREATE TABLE t (id INT);";
    expect(normalizeSQL(sql)).toBe('CREATE TABLE t (id INT);');
  });

  it('returns empty string for comment-only input', () => {
    expect(normalizeSQL('-- just a comment\n/* another */\n')).toBe('');
  });
});

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

    it('produces same checksum regardless of comments', () => {
      const bare = 'CREATE TABLE users (id SERIAL);';
      const commented = '-- header comment\nCREATE TABLE users (id SERIAL); -- inline';
      expect(checksumString(bare)).toBe(checksumString(commented));
    });

    it('produces same checksum regardless of whitespace differences', () => {
      const a = 'CREATE TABLE users (id SERIAL);';
      const b = 'CREATE  TABLE  users  (id   SERIAL);';
      expect(checksumString(a)).toBe(checksumString(b));
    });
  });

  describe('checksumFile', () => {
    it('computes checksum from file content', async () => {
      const content = 'CREATE TABLE IF NOT EXISTS users (id SERIAL);';
      const filePath = join(tempDir, 'test.sql');
      await writeFile(filePath, content);

      const fileHash = await checksumFile(filePath);
      const stringHash = checksumString(content);
      expect(fileHash).toBe(stringHash);
    });

    it('ignores comments in file when computing checksum', async () => {
      const bare = 'CREATE TABLE t (id SERIAL);';
      const withComments = '-- file header\nCREATE TABLE t (id SERIAL);\n-- footer\n';
      const filePath = join(tempDir, 'test.sql');
      await writeFile(filePath, withComments);

      expect(await checksumFile(filePath)).toBe(checksumString(bare));
    });

    it('throws for non-existent file', async () => {
      await expect(checksumFile(join(tempDir, 'nonexistent.sql'))).rejects.toThrow();
    });
  });
});
