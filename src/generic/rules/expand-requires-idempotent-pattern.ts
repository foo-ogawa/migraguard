import type { GenericLintRule } from '../engine.js';

export const expandRequiresIdempotentPattern: GenericLintRule = {
  id: 'expand-requires-idempotent-pattern',
  description: 'Expand phase must use idempotent patterns (IF NOT EXISTS)',
  applicablePhases: ['expand'],
  create() {
    return {
      create_table(node, ctx) {
        if (!node.if_not_exists) {
          const tables = node.table as Array<{ table?: string }> | undefined;
          ctx.report({
            message: `CREATE TABLE ${tables?.[0]?.table ?? ''} without IF NOT EXISTS in expand phase`,
            hint: 'Use CREATE TABLE IF NOT EXISTS for idempotent expand migrations',
          });
        }
      },
      create_index(node, ctx) {
        if (!node.if_not_exists) {
          const index = typeof node.index === 'string'
            ? node.index
            : (node.index as { name?: string })?.name ?? '';
          ctx.report({
            message: `CREATE INDEX ${index} without IF NOT EXISTS in expand phase`,
            hint: 'Use CREATE INDEX IF NOT EXISTS for idempotent expand migrations',
          });
        }
      },
    };
  },
};
