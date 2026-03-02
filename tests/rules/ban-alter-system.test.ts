import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-alter-system');

describe('ban-alter-system', () => {
  it('flags ALTER SYSTEM SET', async () => {
    const v = await runRules("ALTER SYSTEM SET work_mem = '256MB';", rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('ban-alter-system');
  });

  it('passes normal SET', async () => {
    const v = await runRules("SET work_mem = '256MB';", rules);
    expect(v).toHaveLength(0);
  });
});
