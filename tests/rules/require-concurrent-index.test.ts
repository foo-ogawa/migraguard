import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-concurrent-index');

describe('require-concurrent-index', () => {
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
