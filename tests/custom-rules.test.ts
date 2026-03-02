import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../src/config.js';
import { commandLint } from '../src/commands/lint.js';
import { ALL_RULES } from '../src/rules/index.js';

const DISABLE_ALL_BUILTIN: Record<string, string> = Object.fromEntries(
  ALL_RULES.map((r) => [r.id, 'off']),
);

const CUSTOM_RULE_JS = `
export default {
  id: 'require-fk-column-suffix',
  description: 'FK columns must end with _id',
  create() {
    return {
      CreateStmt(node, ctx) {
        const tableElts = node.tableElts;
        if (!Array.isArray(tableElts)) return;
        for (const elt of tableElts) {
          if (!elt.ColumnDef) continue;
          const col = elt.ColumnDef;
          const colname = col.colname;
          const constraints = col.constraints;
          if (!Array.isArray(constraints)) continue;
          const hasFk = constraints.some(
            (c) => c.Constraint && c.Constraint.contype === 'CONSTR_FOREIGN',
          );
          if (hasFk && typeof colname === 'string' && !colname.endsWith('_id')) {
            ctx.report({
              message: 'FK column "' + colname + '" does not end with _id',
              hint: 'Rename to end with _id',
            });
          }
        }
      },
    };
  },
};
`;

describe('custom lint rules', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-custom-rule-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function setup(sql: string) {
    const migDir = join(tempDir, 'db', 'migrations');
    const rulesDir = join(tempDir, 'custom-rules');
    await mkdir(migDir, { recursive: true });
    await mkdir(rulesDir, { recursive: true });
    await writeFile(join(migDir, '20260301_120000__test.sql'), sql);
    await writeFile(join(rulesDir, 'require-fk-column-suffix.mjs'), CUSTOM_RULE_JS);
    return buildConfig({
      migrationsDir: 'db/migrations',
      lint: {
        customRulesDir: 'custom-rules',
        rules: DISABLE_ALL_BUILTIN,
      },
    }, tempDir);
  }

  it('flags FK column not ending with _id', async () => {
    const config = await setup('CREATE TABLE IF NOT EXISTS orders (user_ref INT REFERENCES users(id));');
    const result = await commandLint(config);
    expect(result.ok).toBe(false);
    expect(result.errors).toBe(1);
  });

  it('passes FK column ending with _id', async () => {
    const config = await setup('CREATE TABLE IF NOT EXISTS orders (user_id INT REFERENCES users(id));');
    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('ignores non-FK columns', async () => {
    const config = await setup('CREATE TABLE IF NOT EXISTS orders (name VARCHAR(256));');
    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
  });

  it('custom rules can be disabled via config', async () => {
    const migDir = join(tempDir, 'db', 'migrations');
    const rulesDir = join(tempDir, 'custom-rules');
    await mkdir(migDir, { recursive: true });
    await mkdir(rulesDir, { recursive: true });
    await writeFile(join(migDir, '20260301_120000__test.sql'), 'CREATE TABLE IF NOT EXISTS orders (user_ref INT REFERENCES users(id));');
    await writeFile(join(rulesDir, 'require-fk-column-suffix.mjs'), CUSTOM_RULE_JS);
    const config = buildConfig({
      migrationsDir: 'db/migrations',
      lint: {
        customRulesDir: 'custom-rules',
        rules: { ...DISABLE_ALL_BUILTIN, 'require-fk-column-suffix': 'off' },
      },
    }, tempDir);
    const result = await commandLint(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
  });
});
