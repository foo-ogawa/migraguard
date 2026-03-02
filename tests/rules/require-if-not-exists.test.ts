import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-if-not-exists');

describe('require-if-not-exists', () => {
  it('flags CREATE TABLE without IF NOT EXISTS', async () => {
    const v = await runRules('CREATE TABLE users (id SERIAL PRIMARY KEY);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('CREATE TABLE');
  });

  it('passes CREATE TABLE IF NOT EXISTS', async () => {
    const v = await runRules('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY);', rules);
    expect(v).toHaveLength(0);
  });

  it('flags CREATE INDEX without IF NOT EXISTS', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY idx ON users (email);', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('CREATE INDEX');
  });

  it('passes CREATE INDEX ... IF NOT EXISTS', async () => {
    const v = await runRules('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON users (email);', rules);
    expect(v).toHaveLength(0);
  });

  it('flags DROP TABLE without IF EXISTS', async () => {
    const v = await runRules('DROP TABLE users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('DROP');
  });

  it('passes DROP TABLE IF EXISTS', async () => {
    const v = await runRules('DROP TABLE IF EXISTS users;', rules);
    expect(v).toHaveLength(0);
  });
});
