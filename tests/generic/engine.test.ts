import { describe, it, expect } from 'vitest';
import { runGenericRules, parseAllowDirectives } from '../../src/generic/engine.js';
import { ALL_GENERIC_RULES } from '../../src/generic/rules/index.js';

describe('generic engine', () => {
  it('returns empty for valid MySQL migration', async () => {
    const sql = `CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY, name VARCHAR(255));`;
    const rules = ALL_GENERIC_RULES.filter((r) => r.id === 'require-if-not-exists');
    const v = await runGenericRules(sql, rules, 'mysql');
    expect(v).toHaveLength(0);
  });

  it('returns empty for valid SQLite migration', async () => {
    const sql = `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);`;
    const rules = ALL_GENERIC_RULES.filter((r) => r.id === 'require-if-not-exists');
    const v = await runGenericRules(sql, rules, 'sqlite');
    expect(v).toHaveLength(0);
  });

  it('fails on SQL that does not parse', async () => {
    const sql = `THIS IS NOT VALID SQL AT ALL;;;`;
    await expect(runGenericRules(sql, ALL_GENERIC_RULES, 'mysql')).rejects.toThrow('the SQL does not parse');
    await expect(runGenericRules(sql, ALL_GENERIC_RULES, 'sqlite')).rejects.toThrow('the SQL does not parse');
  });

  it('reads backfill placeholders as values', async () => {
    const sql = 'UPDATE users SET handle = username WHERE handle IS NULL AND id BETWEEN :batch_start AND :batch_end;';
    await expect(runGenericRules(sql, ALL_GENERIC_RULES, 'mysql')).resolves.toBeInstanceOf(Array);
    await expect(runGenericRules(sql, ALL_GENERIC_RULES, 'sqlite')).resolves.toBeInstanceOf(Array);
  });

  it('handles multiple statements', async () => {
    const sql = `CREATE TABLE users (id BIGINT PRIMARY KEY);
CREATE TABLE posts (id BIGINT PRIMARY KEY);`;
    const rules = ALL_GENERIC_RULES.filter((r) => r.id === 'require-if-not-exists');
    const v = await runGenericRules(sql, rules, 'mysql');
    expect(v).toHaveLength(2);
  });

  it('respects allow directives', async () => {
    const sql = `-- migraguard:allow require-if-not-exists
CREATE TABLE users (id BIGINT PRIMARY KEY);`;
    const rules = ALL_GENERIC_RULES.filter((r) => r.id === 'require-if-not-exists');
    const v = await runGenericRules(sql, rules, 'mysql');
    expect(v).toHaveLength(0);
  });
});

describe('parseAllowDirectives', () => {
  it('parses single directive', () => {
    const result = parseAllowDirectives('-- migraguard:allow ban-drop-column');
    expect(result.has('ban-drop-column')).toBe(true);
  });

  it('parses multiple comma-separated directives', () => {
    const result = parseAllowDirectives('-- migraguard:allow ban-drop-column, ban-alter-column-type');
    expect(result.has('ban-drop-column')).toBe(true);
    expect(result.has('ban-alter-column-type')).toBe(true);
  });
});
