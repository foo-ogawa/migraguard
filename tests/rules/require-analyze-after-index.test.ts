import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-analyze-after-index');

describe('require-analyze-after-index', () => {
  it('flags CREATE INDEX without subsequent ANALYZE <table>', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('users');
  });

  it('passes when ANALYZE <table> follows CREATE INDEX', async () => {
    const sql = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);\nANALYZE users;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('does NOT accept bare ANALYZE without table name', async () => {
    const sql = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);\nANALYZE;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
  });

  it('flags only tables without ANALYZE', async () => {
    const sql = `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_u ON users (email);
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_o ON orders (total);
      ANALYZE users;
    `;
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('orders');
  });

  it('does not flag DROP INDEX (table unknown from AST)', async () => {
    const v = await runRules('DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;', rules);
    expect(v).toHaveLength(0);
  });
});
