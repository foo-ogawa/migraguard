import { describe, it, expect } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { ALL_RULES } from '../src/rules/index.js';
import type { LintRule } from '../src/rules/engine.js';

function pick(...ids: string[]): LintRule[] {
  return ALL_RULES.filter((r) => ids.includes(r.id));
}

describe('require-concurrent-index', () => {
  const rules = pick('require-concurrent-index');

  it('flags CREATE INDEX without CONCURRENTLY on existing table', async () => {
    const v = await runRules('CREATE INDEX idx ON users (email);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('require-concurrent-index');
  });

  it('passes CREATE INDEX CONCURRENTLY', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });

  it('skips index on table created in the same file', async () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);
      CREATE INDEX idx ON users (id);
    `;
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });
});

describe('require-if-not-exists', () => {
  const rules = pick('require-if-not-exists');

  it('flags CREATE TABLE without IF NOT EXISTS', async () => {
    const v = await runRules('CREATE TABLE users (id SERIAL PRIMARY KEY);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('CREATE TABLE');
  });

  it('passes CREATE TABLE IF NOT EXISTS', async () => {
    const v = await runRules('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);', rules);
    expect(v).toHaveLength(0);
  });

  it('flags CREATE INDEX without IF NOT EXISTS', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY idx ON users (email);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('CREATE INDEX');
  });

  it('passes CREATE INDEX ... IF NOT EXISTS', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });

  it('flags DROP TABLE without IF EXISTS', async () => {
    const v = await runRules('DROP TABLE users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('DROP');
  });

  it('passes DROP TABLE IF EXISTS', async () => {
    const v = await runRules('DROP TABLE IF EXISTS users;', rules);
    expect(v).toHaveLength(0);
  });
});

describe('require-lock-timeout', () => {
  const rules = pick('require-lock-timeout');

  it('flags DDL without prior SET lock_timeout', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('require-lock-timeout');
  });

  it('passes when SET lock_timeout precedes DDL', async () => {
    const sql = `
      SET lock_timeout = '5s';
      ALTER TABLE users ADD COLUMN phone VARCHAR(32);
    `;
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('flags only once even with multiple DDL statements', async () => {
    const sql = `
      ALTER TABLE users ADD COLUMN a INT;
      ALTER TABLE users ADD COLUMN b INT;
    `;
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
  });

  it('does not flag CREATE INDEX CONCURRENTLY', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });
});

describe('ban-concurrent-index-in-transaction', () => {
  const rules = pick('ban-concurrent-index-in-transaction');

  it('flags CONCURRENTLY inside BEGIN...COMMIT', async () => {
    const sql = `
      BEGIN;
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);
      COMMIT;
    `;
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('ban-concurrent-index-in-transaction');
  });

  it('passes CONCURRENTLY outside a transaction', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });
});

describe('adding-not-nullable-field', () => {
  const rules = pick('adding-not-nullable-field');

  it('flags NOT NULL column without DEFAULT', async () => {
    const sql = 'ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('adding-not-nullable-field');
    expect(v[0].message).toContain('status');
  });

  it('passes NOT NULL column with DEFAULT', async () => {
    const sql = "ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active';";
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('passes nullable column without DEFAULT', async () => {
    const sql = 'ALTER TABLE users ADD COLUMN phone VARCHAR(32);';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });
});

describe('constraint-missing-not-valid', () => {
  const rules = pick('constraint-missing-not-valid');

  it('flags ADD CONSTRAINT (FK) without NOT VALID', async () => {
    const sql = 'ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('constraint-missing-not-valid');
  });

  it('passes ADD CONSTRAINT with NOT VALID', async () => {
    const sql = 'ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });
});

describe('all rules combined', () => {
  it('returns no violations for a well-written migration', async () => {
    const sql = `
      SET lock_timeout = '5s';
      SET statement_timeout = '30s';
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(256));
    `;
    const v = await runRules(sql, ALL_RULES);
    expect(v).toHaveLength(0);
  });

  it('reports multiple violations from different rules', async () => {
    const sql = 'CREATE TABLE users (id SERIAL PRIMARY KEY);';
    const v = await runRules(sql, ALL_RULES);
    const ruleIds = v.map((x) => x.rule);
    expect(ruleIds).toContain('require-if-not-exists');
    expect(ruleIds).toContain('require-lock-timeout');
  });

  it('returns no violations when no rules are passed', async () => {
    const sql = 'CREATE TABLE users (id SERIAL PRIMARY KEY);';
    const v = await runRules(sql, []);
    expect(v).toHaveLength(0);
  });
});
