import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-drop-table');

describe('ban-drop-table', () => {
  it('flags DROP TABLE', async () => {
    const v = await runRules('DROP TABLE users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('users');
  });

  it('flags DROP TABLE IF EXISTS', async () => {
    const v = await runRules('DROP TABLE IF EXISTS users;', rules);
    expect(v).toHaveLength(1);
  });

  it('passes DROP INDEX', async () => {
    const v = await runRules('DROP INDEX idx_users_email;', rules);
    expect(v).toHaveLength(0);
  });

  it('passes DROP VIEW', async () => {
    const v = await runRules('DROP VIEW IF EXISTS active_users;', rules);
    expect(v).toHaveLength(0);
  });
});
