import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-vacuum-full');

describe('ban-vacuum-full', () => {
  it('flags VACUUM FULL', async () => {
    const v = await runRules('VACUUM FULL users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('ban-vacuum-full');
  });

  it('passes normal VACUUM', async () => {
    const v = await runRules('VACUUM users;', rules);
    expect(v).toHaveLength(0);
  });

  it('passes ANALYZE (VacuumStmt but not FULL)', async () => {
    const v = await runRules('ANALYZE users;', rules);
    expect(v).toHaveLength(0);
  });
});
