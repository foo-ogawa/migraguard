import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-delete-without-where');

describe('ban-delete-without-where', () => {
  it('flags DELETE without WHERE', async () => {
    const v = await runRules('DELETE FROM users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('users');
  });

  it('passes DELETE with WHERE', async () => {
    const v = await runRules("DELETE FROM users WHERE status = 'inactive';", rules);
    expect(v).toHaveLength(0);
  });
});
