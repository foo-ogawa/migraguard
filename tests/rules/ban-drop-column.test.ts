import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-drop-column');

describe('ban-drop-column', () => {
  it('flags DROP COLUMN', async () => {
    const v = await runRules('ALTER TABLE users DROP COLUMN email;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('email');
  });

  it('passes ADD COLUMN', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules);
    expect(v).toHaveLength(0);
  });
});
