import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-reset-timeouts');

describe('require-reset-timeouts', () => {
  it('flags SET lock_timeout without RESET', async () => {
    const sql = "SET lock_timeout = '5s';\nALTER TABLE users ADD COLUMN a INT;";
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('lock_timeout');
  });

  it('flags SET statement_timeout without RESET', async () => {
    const sql = "SET statement_timeout = '30s';\nALTER TABLE users ADD COLUMN a INT;";
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('statement_timeout');
  });

  it('passes when both SET and RESET are present', async () => {
    const sql = "SET lock_timeout = '5s';\nALTER TABLE users ADD COLUMN a INT;\nRESET lock_timeout;";
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('no violation when no SET is used', async () => {
    const v = await runRules('SELECT 1;', rules);
    expect(v).toHaveLength(0);
  });
});
