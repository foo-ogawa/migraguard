import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-cluster');

describe('ban-cluster', () => {
  it('flags CLUSTER with table and index', async () => {
    const v = await runRules('CLUSTER users USING idx_users_email;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('users');
  });

  it('flags bare CLUSTER', async () => {
    const v = await runRules('CLUSTER;', rules);
    expect(v).toHaveLength(1);
  });
});
