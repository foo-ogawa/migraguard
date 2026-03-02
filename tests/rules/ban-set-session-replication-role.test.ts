import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-set-session-replication-role');

describe('ban-set-session-replication-role', () => {
  it('flags SET session_replication_role', async () => {
    const v = await runRules("SET session_replication_role = 'replica';", rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('ban-set-session-replication-role');
  });

  it('passes SET other variables', async () => {
    const v = await runRules("SET lock_timeout = '5s';", rules);
    expect(v).toHaveLength(0);
  });
});
