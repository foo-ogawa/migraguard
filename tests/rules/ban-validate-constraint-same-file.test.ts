import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-validate-constraint-same-file');

describe('ban-validate-constraint-same-file', () => {
  it('flags VALIDATE CONSTRAINT in same file as NOT VALID', async () => {
    const sql = `
      ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (uid) REFERENCES users(id) NOT VALID;
      ALTER TABLE orders VALIDATE CONSTRAINT fk;
    `;
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('fk');
  });

  it('passes NOT VALID without VALIDATE in same file', async () => {
    const sql = 'ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (uid) REFERENCES users(id) NOT VALID;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('passes VALIDATE alone (NOT VALID was in a previous migration)', async () => {
    const sql = 'ALTER TABLE orders VALIDATE CONSTRAINT fk;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });
});
