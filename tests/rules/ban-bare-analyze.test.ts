import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-bare-analyze');

describe('ban-bare-analyze', () => {
  it('flags ANALYZE without table name', async () => {
    const v = await runRules('ANALYZE;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('ban-bare-analyze');
  });

  it('passes ANALYZE with table name', async () => {
    const v = await runRules('ANALYZE users;', rules);
    expect(v).toHaveLength(0);
  });
});
