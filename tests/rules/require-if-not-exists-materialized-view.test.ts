import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-if-not-exists-materialized-view');

describe('require-if-not-exists-materialized-view', () => {
  it('flags CREATE MATERIALIZED VIEW without IF NOT EXISTS', async () => {
    const v = await runRules('CREATE MATERIALIZED VIEW mv AS SELECT 1;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('mv');
  });

  it('passes CREATE MATERIALIZED VIEW IF NOT EXISTS', async () => {
    const v = await runRules('CREATE MATERIALIZED VIEW IF NOT EXISTS mv AS SELECT 1;', rules);
    expect(v).toHaveLength(0);
  });

  it('does not flag regular CREATE TABLE', async () => {
    const v = await runRules('CREATE TABLE IF NOT EXISTS users (id INT);', rules);
    expect(v).toHaveLength(0);
  });
});
