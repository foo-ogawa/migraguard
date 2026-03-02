import { describe, it, expect } from 'vitest';
import { runRules } from '../../src/rules/engine.js';
import { pick } from './helper.js';

const rules = pick('require-create-or-replace-view');

describe('require-create-or-replace-view', () => {
  it('flags CREATE VIEW without OR REPLACE', async () => {
    const v = await runRules('CREATE VIEW v AS SELECT 1;', rules);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('OR REPLACE');
  });

  it('passes CREATE OR REPLACE VIEW', async () => {
    const v = await runRules('CREATE OR REPLACE VIEW v AS SELECT 1;', rules);
    expect(v).toHaveLength(0);
  });
});
