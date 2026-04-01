import { describe, it, expect } from 'vitest';
import { normalizeSchema } from '../src/dumper.js';

describe('normalizeSchema', () => {
  it('strips PG-specific lines from pg_dump output', () => {
    const input = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      '',
      'SET statement_timeout = 0;',
      'SET lock_timeout = 0;',
      '',
      'SELECT pg_catalog.set_config(\'search_path\', \'\', false);',
      '',
      'CREATE TABLE users (',
      '    id integer NOT NULL',
      ');',
      '',
      'COMMENT ON EXTENSION plpgsql IS \'stuff\';',
      '',
      '',
    ].join('\n');

    const result = normalizeSchema(input);
    expect(result).not.toContain('SET statement_timeout');
    expect(result).not.toContain('pg_catalog');
    expect(result).not.toContain('COMMENT ON EXTENSION');
    expect(result).not.toContain('--');
    expect(result).toContain('CREATE TABLE users');
    expect(result.endsWith('\n')).toBe(true);
  });

  it('collapses consecutive blank lines', () => {
    const input = 'CREATE TABLE a ();\n\n\n\nCREATE TABLE b ();';
    const result = normalizeSchema(input);
    expect(result).not.toContain('\n\n\n');
    expect(result).toContain('CREATE TABLE a');
    expect(result).toContain('CREATE TABLE b');
  });
});
