import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-drop-index-concurrently');

describe('require-drop-index-concurrently', () => {
  it('flags DROP INDEX without CONCURRENTLY', async () => {
    const v = await runRules('DROP INDEX IF EXISTS idx_test;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('require-drop-index-concurrently');
  });

  it('passes DROP INDEX CONCURRENTLY', async () => {
    const v = await runRules('DROP INDEX CONCURRENTLY IF EXISTS idx_test;', rules);
    expect(v).toHaveLength(0);
  });

  it('does not flag DROP TABLE', async () => {
    const v = await runRules('DROP TABLE IF EXISTS users;', rules);
    expect(v).toHaveLength(0);
  });
});
