import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-lock-timeout');

describe('require-lock-timeout', () => {
  it('flags DDL without prior SET lock_timeout', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('require-lock-timeout');
  });

  it('passes when SET lock_timeout precedes DDL', async () => {
    const sql = "SET lock_timeout = '5s';\nALTER TABLE users ADD COLUMN phone VARCHAR(32);";
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('flags only once even with multiple DDL', async () => {
    const sql = 'ALTER TABLE users ADD COLUMN a INT;\nALTER TABLE users ADD COLUMN b INT;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
  });

  it('does not flag CREATE INDEX CONCURRENTLY', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });
});
