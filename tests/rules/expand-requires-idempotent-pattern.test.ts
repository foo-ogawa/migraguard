import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('expand-requires-idempotent-pattern');

describe('expand-requires-idempotent-pattern', () => {
  it('flags CREATE TABLE without IF NOT EXISTS', async () => {
    const v = await runRules('CREATE TABLE users (id SERIAL);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe('expand-requires-idempotent-pattern');
  });

  it('passes CREATE TABLE IF NOT EXISTS', async () => {
    const v = await runRules('CREATE TABLE IF NOT EXISTS users (id SERIAL);', rules);
    expect(v).toHaveLength(0);
  });

  it('flags CREATE INDEX without IF NOT EXISTS', async () => {
    const v = await runRules('CREATE INDEX idx_users ON users (name);', rules);
    expect(v).toHaveLength(1);
  });

  it('has applicablePhases set to expand', () => {
    expect(rules[0].applicablePhases).toEqual(['expand']);
  });
});
