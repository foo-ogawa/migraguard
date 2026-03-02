import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-statement-timeout');

describe('require-statement-timeout', () => {
  it('flags DDL without prior SET statement_timeout', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('require-statement-timeout');
  });

  it('passes when SET statement_timeout precedes DDL', async () => {
    const sql = "SET statement_timeout = '30s';\nALTER TABLE users ADD COLUMN phone VARCHAR(32);";
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('does not flag CREATE INDEX CONCURRENTLY', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });
});
