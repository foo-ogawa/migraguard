import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-unique-via-concurrent-index');

describe('require-unique-via-concurrent-index', () => {
  it('flags ADD CONSTRAINT UNIQUE without USING INDEX', async () => {
    const sql = 'ALTER TABLE users ADD CONSTRAINT u_email UNIQUE (email);';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('UNIQUE');
  });

  it('passes ADD CONSTRAINT UNIQUE USING INDEX', async () => {
    const sql = 'ALTER TABLE users ADD CONSTRAINT u_email UNIQUE USING INDEX idx_users_email;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });
});
