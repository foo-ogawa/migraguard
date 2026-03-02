import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-rename-column');

describe('ban-rename-column', () => {
  it('flags RENAME COLUMN', async () => {
    const v = await runRules('ALTER TABLE users RENAME COLUMN old_name TO new_name;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('old_name');
    expect(v[0].message).toContain('new_name');
  });

  it('passes RENAME TABLE (not column)', async () => {
    const v = await runRules('ALTER TABLE users RENAME TO customers;', rules);
    expect(v).toHaveLength(0);
  });

  it('passes ADD COLUMN', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules);
    expect(v).toHaveLength(0);
  });
});
