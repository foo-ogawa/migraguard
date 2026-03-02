import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-pk-via-concurrent-index');

describe('require-pk-via-concurrent-index', () => {
  it('flags ADD PRIMARY KEY without USING INDEX', async () => {
    const v = await runRules('ALTER TABLE account ADD PRIMARY KEY (id);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('account');
  });

  it('passes ADD PRIMARY KEY USING INDEX', async () => {
    const v = await runRules(
      'ALTER TABLE account ADD CONSTRAINT account_pk PRIMARY KEY USING INDEX account_pk_idx;',
      rules,
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag UNIQUE constraints', async () => {
    const v = await runRules(
      'ALTER TABLE account ADD CONSTRAINT u_email UNIQUE USING INDEX idx_email;',
      rules,
    );
    expect(v).toHaveLength(0);
  });
});
