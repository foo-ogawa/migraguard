import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('backfill-ban-ddl');

describe('backfill-ban-ddl', () => {
  it('flags CREATE TABLE in backfill', async () => {
    const v = await runRules('CREATE TABLE temp (id INT);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('backfill-ban-ddl');
  });

  it('flags ALTER TABLE in backfill', async () => {
    const v = await runRules('ALTER TABLE users ADD COLUMN new_col INT;', rules);
    expect(v).toHaveLength(1);
  });

  it('passes DML statements', async () => {
    const v = await runRules('UPDATE users SET status_v2 = status WHERE status_v2 IS NULL;', rules);
    expect(v).toHaveLength(0);
  });

  it('has applicablePhases set to backfill', () => {
    expect(rules[0].applicablePhases).toEqual(['backfill']);
  });
});
