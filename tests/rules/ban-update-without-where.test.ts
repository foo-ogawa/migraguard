import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-update-without-where');

describe('ban-update-without-where', () => {
  it('flags UPDATE without WHERE', async () => {
    const v = await runRules('UPDATE users SET status = 1;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('users');
  });

  it('passes UPDATE with WHERE', async () => {
    const v = await runRules('UPDATE users SET status = 1 WHERE id = 1;', rules);
    expect(v).toHaveLength(0);
  });
});
