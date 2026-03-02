import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('ban-select-star-in-view');

describe('ban-select-star-in-view', () => {
  it('flags SELECT * in VIEW', async () => {
    const v = await runRules('CREATE OR REPLACE VIEW v AS SELECT * FROM users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('v');
  });

  it('flags table.* in VIEW', async () => {
    const v = await runRules('CREATE OR REPLACE VIEW v AS SELECT u.* FROM users u;', rules);
    expect(v).toHaveLength(1);
  });

  it('passes explicit column list in VIEW', async () => {
    const v = await runRules('CREATE OR REPLACE VIEW v AS SELECT id, name FROM users;', rules);
    expect(v).toHaveLength(0);
  });

  it('flags SELECT * in MATERIALIZED VIEW', async () => {
    const v = await runRules('CREATE MATERIALIZED VIEW IF NOT EXISTS mv AS SELECT * FROM users;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('mv');
  });

  it('passes explicit columns in MATERIALIZED VIEW', async () => {
    const v = await runRules('CREATE MATERIALIZED VIEW IF NOT EXISTS mv AS SELECT id, name FROM users;', rules);
    expect(v).toHaveLength(0);
  });

  it('does not flag SELECT * in regular SELECT (not a VIEW)', async () => {
    const v = await runRules('SELECT * FROM users;', rules);
    expect(v).toHaveLength(0);
  });
});
