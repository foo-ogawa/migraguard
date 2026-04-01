import type { GenericLintRule } from '../engine.js';

export const requireIfNotExists: GenericLintRule = {
  id: 'require-if-not-exists',
  description: 'CREATE must use IF NOT EXISTS, DROP must use IF EXISTS',
  create() {
    return {
      create_table(node, ctx) {
        if (!node.if_not_exists) {
          const tables = node.table as Array<{ table?: string }> | undefined;
          ctx.report({
            message: `CREATE TABLE ${tables?.[0]?.table ?? '(unknown)'} without IF NOT EXISTS`,
            hint: 'Use CREATE TABLE IF NOT EXISTS for idempotent migrations',
          });
        }
      },
      create_index(node, ctx) {
        if (!node.if_not_exists) {
          const index = typeof node.index === 'string'
            ? node.index
            : (node.index as { name?: string })?.name ?? '';
          ctx.report({
            message: `CREATE INDEX ${index} without IF NOT EXISTS`,
            hint: 'Use CREATE INDEX IF NOT EXISTS for idempotent migrations',
          });
        }
      },
      drop(node, ctx) {
        if (!node.prefix) {
          ctx.report({
            message: 'DROP without IF EXISTS',
            hint: 'Use DROP ... IF EXISTS for idempotent migrations',
          });
        }
      },
    };
  },
};
