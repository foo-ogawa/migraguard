import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-reindex');

describe('ban-reindex', () => {
  it('flags REINDEX TABLE', async () => {
    const v = await runRules('REINDEX TABLE users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('users');
  });

  it('flags REINDEX INDEX', async () => {
    const v = await runRules('REINDEX INDEX idx_users_email;', rules);
    expect(v).toHaveLength(1);
  });

  it('flags REINDEX TABLE CONCURRENTLY too', async () => {
    const v = await runRules('REINDEX TABLE CONCURRENTLY users;', rules);
    expect(v).toHaveLength(1);
  });
});
