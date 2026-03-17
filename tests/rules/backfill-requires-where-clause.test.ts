import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('backfill-requires-where-clause');

describe('backfill-requires-where-clause', () => {
  it('flags UPDATE without WHERE', async () => {
    const v = await runRules('UPDATE users SET status_v2 = status;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('backfill-requires-where-clause');
  });

  it('passes UPDATE with WHERE', async () => {
    const v = await runRules('UPDATE users SET status_v2 = status WHERE status_v2 IS NULL;', rules);
    expect(v).toHaveLength(0);
  });

  it('flags DELETE without WHERE', async () => {
    const v = await runRules('DELETE FROM temp_data;', rules);
    expect(v).toHaveLength(1);
  });

  it('has applicablePhases set to backfill', () => {
    expect(rules[0].applicablePhases).toEqual(['backfill']);
  });
});
