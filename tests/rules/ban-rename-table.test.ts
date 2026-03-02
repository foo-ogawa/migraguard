import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-rename-table');

describe('ban-rename-table', () => {
  it('flags RENAME TABLE', async () => {
    const v = await runRules('ALTER TABLE users RENAME TO customers;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('users');
    expect(v[0].message).toContain('customers');
  });

  it('passes RENAME COLUMN (not table)', async () => {
    const v = await runRules('ALTER TABLE users RENAME COLUMN old_name TO new_name;', rules);
    expect(v).toHaveLength(0);
  });
});
