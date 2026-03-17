import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('contract-requires-allow-directive');

describe('contract-requires-allow-directive', () => {
  it('flags DROP TABLE without allow directive', async () => {
    const v = await runRules('DROP TABLE IF EXISTS old_table;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('contract-requires-allow-directive');
  });

  it('passes when allow directive is present (suppressed by engine)', async () => {
    const sql = `-- migraguard:allow contract-requires-allow-directive
DROP TABLE IF EXISTS old_table;`;
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('flags ALTER TABLE DROP COLUMN', async () => {
    const v = await runRules('ALTER TABLE users DROP COLUMN status;', rules);
    expect(v).toHaveLength(1);
  });

  it('has applicablePhases set to contract', () => {
    expect(rules[0].applicablePhases).toEqual(['contract']);
  });
});
