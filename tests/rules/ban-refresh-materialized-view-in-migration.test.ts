import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-refresh-materialized-view-in-migration');

describe('ban-refresh-materialized-view-in-migration', () => {
  it('flags REFRESH MATERIALIZED VIEW', async () => {
    const v = await runRules('REFRESH MATERIALIZED VIEW mv;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('mv');
  });

  it('flags REFRESH MATERIALIZED VIEW CONCURRENTLY', async () => {
    const v = await runRules('REFRESH MATERIALIZED VIEW CONCURRENTLY mv;', rules);
    expect(v).toHaveLength(1);
  });

  it('does not flag CREATE MATERIALIZED VIEW', async () => {
    const v = await runRules('CREATE MATERIALIZED VIEW IF NOT EXISTS mv AS SELECT 1;', rules);
    expect(v).toHaveLength(0);
  });
});
