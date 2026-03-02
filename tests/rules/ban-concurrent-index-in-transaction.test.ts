import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-concurrent-index-in-transaction');

describe('ban-concurrent-index-in-transaction', () => {
  it('flags CONCURRENTLY inside BEGIN...COMMIT', async () => {
    const sql = 'BEGIN;\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);\nCOMMIT;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('ban-concurrent-index-in-transaction');
  });

  it('passes CONCURRENTLY outside a transaction', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });
});
