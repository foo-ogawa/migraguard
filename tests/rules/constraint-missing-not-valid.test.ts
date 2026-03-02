import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('constraint-missing-not-valid');

describe('constraint-missing-not-valid', () => {
  it('flags ADD CONSTRAINT FK without NOT VALID', async () => {
    const sql = 'ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users(id);';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
  });

  it('passes ADD CONSTRAINT FK with NOT VALID', async () => {
    const sql = 'ALTER TABLE orders ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;';
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });
});
