import { describe, it, expect } from 'vitest';
import { runRules, parseAllowDirectives } from '../../src/rules/engine.js';
import { pick } from './helper.js';

describe('-- migraguard:allow directive', () => {
  it('parses single rule', () => {
    const sql = '-- migraguard:allow ban-drop-column\nALTER TABLE users DROP COLUMN email;';
    const allowed = parseAllowDirectives(sql);
    expect(allowed.has('ban-drop-column')).toBe(true);
  });

  it('parses multiple rules comma-separated', () => {
    const sql = '-- migraguard:allow ban-drop-column, ban-alter-column-type\nSELECT 1;';
    const allowed = parseAllowDirectives(sql);
    expect(allowed.has('ban-drop-column')).toBe(true);
    expect(allowed.has('ban-alter-column-type')).toBe(true);
  });

  it('parses multiple directives on separate lines', () => {
    const sql = '-- migraguard:allow ban-drop-column\n-- migraguard:allow require-lock-timeout\nSELECT 1;';
    const allowed = parseAllowDirectives(sql);
    expect(allowed.has('ban-drop-column')).toBe(true);
    expect(allowed.has('require-lock-timeout')).toBe(true);
  });

  it('suppresses violations for allowed rules', async () => {
    const sql = '-- migraguard:allow ban-drop-column\nALTER TABLE users DROP COLUMN email;';
    const rules = pick('ban-drop-column');
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(0);
  });

  it('does not suppress other rules', async () => {
    const sql = '-- migraguard:allow ban-truncate\nALTER TABLE users DROP COLUMN email;';
    const rules = pick('ban-drop-column');
    const v = await runRules(sql, rules);
    expect(v).toHaveLength(1);
  });
});
