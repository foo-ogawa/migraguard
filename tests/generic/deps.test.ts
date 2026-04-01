import { describe, it, expect } from 'vitest';
import { analyzeGenericSql } from '../../src/generic/deps.js';

describe('generic deps — MySQL', () => {
  const d = 'mysql' as const;

  it('extracts CREATE TABLE', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY);';
    const { creates, references } = analyzeGenericSql(sql, d);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual({ type: 'table', name: 'users' });
    expect(references).toHaveLength(0);
  });

  it('extracts CREATE INDEX reference', () => {
    const sql = 'CREATE INDEX idx_email ON users (email);';
    const { creates, references } = analyzeGenericSql(sql, d);
    expect(creates).toHaveLength(0);
    expect(references).toHaveLength(1);
    expect(references[0]).toEqual({ type: 'table', name: 'users' });
  });

  it('extracts ALTER TABLE reference', () => {
    const sql = 'ALTER TABLE users ADD COLUMN email VARCHAR(255);';
    const { references } = analyzeGenericSql(sql, d);
    expect(references).toHaveLength(1);
    expect(references[0]).toEqual({ type: 'table', name: 'users' });
  });

  it('extracts FK reference from CREATE TABLE', () => {
    const sql = `CREATE TABLE IF NOT EXISTS posts (
      id BIGINT PRIMARY KEY,
      user_id BIGINT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );`;
    const { creates, references } = analyzeGenericSql(sql, d);
    expect(creates).toHaveLength(1);
    expect(creates[0].name).toBe('posts');
    expect(references).toHaveLength(1);
    expect(references[0].name).toBe('users');
  });

  it('extracts FK reference from ALTER TABLE', () => {
    const sql = 'ALTER TABLE posts ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);';
    const { references } = analyzeGenericSql(sql, d);
    expect(references.some((r) => r.name === 'users')).toBe(true);
  });

  it('extracts CREATE VIEW and source tables', () => {
    const sql = 'CREATE OR REPLACE VIEW user_emails AS SELECT id, email FROM users;';
    const { creates, references } = analyzeGenericSql(sql, d);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual({ type: 'view', name: 'user_emails' });
    expect(references).toHaveLength(1);
    expect(references[0].name).toBe('users');
  });

  it('filters out self-references', () => {
    const sql = `CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY);
CREATE INDEX idx_users_id ON users (id);`;
    const { creates, references } = analyzeGenericSql(sql, d);
    expect(creates).toHaveLength(1);
    expect(references).toHaveLength(0);
  });

  it('returns empty on parse failure', () => {
    const { creates, references } = analyzeGenericSql('NOT VALID SQL!!!', d);
    expect(creates).toHaveLength(0);
    expect(references).toHaveLength(0);
  });
});

describe('generic deps — SQLite', () => {
  const d = 'sqlite' as const;

  it('extracts CREATE TABLE', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY);';
    const { creates } = analyzeGenericSql(sql, d);
    expect(creates).toHaveLength(1);
    expect(creates[0].name).toBe('users');
  });

  it('extracts inline FK reference', () => {
    const sql = `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      title TEXT NOT NULL
    );`;
    const { creates, references } = analyzeGenericSql(sql, d);
    expect(creates[0].name).toBe('posts');
    expect(references).toHaveLength(1);
    expect(references[0].name).toBe('users');
  });

  it('extracts CREATE INDEX reference', () => {
    const sql = 'CREATE INDEX IF NOT EXISTS idx_email ON users (email);';
    const { references } = analyzeGenericSql(sql, d);
    expect(references).toHaveLength(1);
    expect(references[0].name).toBe('users');
  });

  it('extracts CREATE VIEW', () => {
    const sql = 'CREATE VIEW IF NOT EXISTS user_emails AS SELECT id, email FROM users;';
    const { creates, references } = analyzeGenericSql(sql, d);
    expect(creates).toHaveLength(1);
    expect(creates[0].name).toBe('user_emails');
    expect(references).toHaveLength(1);
    expect(references[0].name).toBe('users');
  });
});
