import { describe, it, expect } from 'vitest';
import { maskPlaceholders } from '../src/placeholders.js';

describe('maskPlaceholders', () => {
  it('reads each :name placeholder as 0, keeping its length', () => {
    const sql = 'WHERE id BETWEEN :batch_start AND :batch_end;';
    const masked = maskPlaceholders(sql);
    expect(masked).toBe(`WHERE id BETWEEN ${'0'.padEnd(':batch_start'.length)} AND ${'0'.padEnd(':batch_end'.length)};`);
    expect(masked).toHaveLength(sql.length);
  });

  it('leaves :: casts, := assignments and colons inside words alone', () => {
    const sql = "SELECT a::int, b::text; v := 1; SELECT '12:30', x:y;";
    expect(maskPlaceholders(sql)).toBe(sql);
  });
});
