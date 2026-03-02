import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-truncate');

describe('ban-truncate', () => {
  it('flags TRUNCATE', async () => {
    const v = await runRules('TRUNCATE users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('ban-truncate');
  });

  it('passes DELETE with WHERE', async () => {
    const v = await runRules("DELETE FROM users WHERE status = 'inactive';", rules);
    expect(v).toHaveLength(0);
  });
});
