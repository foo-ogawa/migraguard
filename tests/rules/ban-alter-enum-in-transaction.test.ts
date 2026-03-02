import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-alter-enum-in-transaction');

describe('ban-alter-enum-in-transaction', () => {
  it('flags ALTER TYPE ADD VALUE inside a transaction', async () => {
    const sql = "BEGIN;\nALTER TYPE status ADD VALUE 'archived';\nCOMMIT;";
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('status');
  });

  it('passes ALTER TYPE ADD VALUE outside a transaction', async () => {
    const v = await runRules("ALTER TYPE status ADD VALUE 'archived';", rules);
    expect(v).toHaveLength(0);
  });
});
