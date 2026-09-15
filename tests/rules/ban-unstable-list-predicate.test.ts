import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-unstable-list-predicate');

describe('ban-unstable-list-predicate', () => {
  it('flags IN (...) on a varchar column in a CHECK constraint', async () => {
    const v = await runRules(
      "CREATE TABLE t (s varchar(20), CONSTRAINT c CHECK (s IN ('a', 'b')));",
      rules,
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('"c"');
    expect(v[0].message).toContain('"s"');
  });

  it('flags an inline column CHECK', async () => {
    const v = await runRules(
      "CREATE TABLE t (s character varying(20) CONSTRAINT c CHECK (s IN ('a', 'b')));",
      rules,
    );
    expect(v).toHaveLength(1);
  });

  it('flags = ANY (ARRAY[...]) without an explicit ::text cast', async () => {
    const v = await runRules(
      "CREATE TABLE t (s varchar(20), CONSTRAINT c CHECK (s = ANY (ARRAY['a'::varchar, 'b'::varchar])));",
      rules,
    );
    expect(v).toHaveLength(1);
  });

  it('passes the explicit ::text cast form', async () => {
    const v = await runRules(
      "CREATE TABLE t (s varchar(20), CONSTRAINT c CHECK (s::text = ANY (ARRAY['a', 'b']::text[])));",
      rules,
    );
    expect(v).toHaveLength(0);
  });

  it('passes IN (...) on a text column', async () => {
    const v = await runRules("CREATE TABLE t (s text, CONSTRAINT c CHECK (s IN ('a', 'b')));", rules);
    expect(v).toHaveLength(0);
  });

  it('passes IN (...) on a bpchar column', async () => {
    const v = await runRules(
      "CREATE TABLE t (s character(3), CONSTRAINT c CHECK (s IN ('a', 'b')));",
      rules,
    );
    expect(v).toHaveLength(0);
  });

  it('passes IN (...) on an integer column', async () => {
    const v = await runRules('CREATE TABLE t (n integer, CONSTRAINT c CHECK (n IN (1, 2)));', rules);
    expect(v).toHaveLength(0);
  });

  it('passes IN (...) on a date column', async () => {
    const v = await runRules(
      "CREATE TABLE t (d date, CONSTRAINT c CHECK (d IN ('2020-01-01', '2021-01-01')));",
      rules,
    );
    expect(v).toHaveLength(0);
  });

  it('flags only the varchar column when a table mixes types', async () => {
    const v = await runRules(
      "CREATE TABLE t (s varchar(20), n integer, CONSTRAINT c1 CHECK (s IN ('a', 'b')), CONSTRAINT c2 CHECK (n IN (1, 2)));",
      rules,
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('"c1"');
  });

  it('flags a DOMAIN CHECK over a varchar base type', async () => {
    const v = await runRules("CREATE DOMAIN d AS varchar(20) CHECK (VALUE IN ('a', 'b'));", rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('CREATE DOMAIN');
  });

  it('passes a DOMAIN CHECK over a text base type', async () => {
    const v = await runRules("CREATE DOMAIN d AS text CHECK (VALUE IN ('a', 'b'));", rules);
    expect(v).toHaveLength(0);
  });

  it('does not report where the column type is not visible in the statement', async () => {
    const v = await runRules("ALTER TABLE t ADD CONSTRAINT c CHECK (s IN ('a', 'b')) NOT VALID;", rules);
    expect(v).toHaveLength(0);
  });

  it('does not flag a plain SELECT', async () => {
    const v = await runRules("SELECT s FROM t WHERE s IN ('a', 'b');", rules);
    expect(v).toHaveLength(0);
  });

  it('can be suppressed with an allow directive', async () => {
    const v = await runRules(
      "-- migraguard:allow ban-unstable-list-predicate\nCREATE TABLE t (s varchar(20), CONSTRAINT c CHECK (s IN ('a', 'b')));",
      rules,
    );
    expect(v).toHaveLength(0);
  });
});
