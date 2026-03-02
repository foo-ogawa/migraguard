import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-drop-cascade');

describe('ban-drop-cascade', () => {
  it('flags DROP VIEW CASCADE', async () => {
    const v = await runRules('DROP VIEW IF EXISTS v CASCADE;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('CASCADE');
  });

  it('flags DROP TABLE CASCADE', async () => {
    const v = await runRules('DROP TABLE IF EXISTS users CASCADE;', rules);
    expect(v).toHaveLength(1);
  });

  it('passes DROP without CASCADE', async () => {
    const v = await runRules('DROP VIEW IF EXISTS v;', rules);
    expect(v).toHaveLength(0);
  });
});
