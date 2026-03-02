import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('adding-not-nullable-field');

describe('adding-not-nullable-field', () => {
  it('flags NOT NULL column without DEFAULT', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('status');
  });

  it('passes NOT NULL column with DEFAULT', async () => {
    const v = await runRules("ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active';", rules);
    expect(v).toHaveLength(0);
  });

  it('passes nullable column', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules);
    expect(v).toHaveLength(0);
  });
});
