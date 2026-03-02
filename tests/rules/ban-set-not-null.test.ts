import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-set-not-null');

describe('ban-set-not-null', () => {
  it('flags SET NOT NULL', async () => {
    const v = await runRules('ALTER TABLE users ALTER COLUMN email SET NOT NULL;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('email');
  });

  it('passes DROP NOT NULL', async () => {
    const v = await runRules('ALTER TABLE users ALTER COLUMN email DROP NOT NULL;', rules);
    expect(v).toHaveLength(0);
  });

  it('passes ADD COLUMN NOT NULL with DEFAULT', async () => {
    const v = await runRules(
      "ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active';",
      rules,
    );
    expect(v).toHaveLength(0);
  });
});
