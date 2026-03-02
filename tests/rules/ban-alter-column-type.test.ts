import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-alter-column-type');

describe('ban-alter-column-type', () => {
  it('flags ALTER COLUMN TYPE', async () => {
    const v = await runRules('ALTER TABLE users ALTER COLUMN email TYPE TEXT;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('email');
  });

  it('passes ADD COLUMN', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules);
    expect(v).toHaveLength(0);
  });
});
