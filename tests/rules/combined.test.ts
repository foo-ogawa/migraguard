import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { ALL_RULES } from '../../src/rules/index.js';

describe('all rules combined', () => {
  it('returns no violations for a well-written migration', async () => {
    const sql = `
      SET lock_timeout = '5s';
      SET statement_timeout = '30s';
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(256));
      RESET lock_timeout;
      RESET statement_timeout;
    `;
    const v = await runRules(sql, ALL_RULES);
    expect(v).toHaveLength(0);
  });

  it('reports multiple violations from different rules', async () => {
    const sql = 'CREATE TABLE users (id SERIAL PRIMARY KEY);';
    const v = await runRules(sql, ALL_RULES);
    const ruleIds = v.map((x) => x.rule);
    expect(ruleIds).toContain('require-if-not-exists');
    expect(ruleIds).toContain('require-lock-timeout');
  });

  it('returns no violations when no rules are passed', async () => {
    const v = await runRules('CREATE TABLE users (id SERIAL PRIMARY KEY);', []);
    expect(v).toHaveLength(0);
  });
});
