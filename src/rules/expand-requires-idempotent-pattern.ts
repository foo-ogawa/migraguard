import type { LintRule } from './engine.js';

export const expandRequiresIdempotentPattern: LintRule = {
  id: 'expand-requires-idempotent-pattern',
  description: 'Expand phase must use idempotent patterns (IF NOT EXISTS, OR REPLACE)',
  applicablePhases: ['expand'],
  create() {
    return {
      CreateStmt(node, ctx) {
        const ifNotExists = node.if_not_exists as boolean | undefined;
        if (!ifNotExists) {
          const rel = node.relation as { relname?: string } | undefined;
          ctx.report({
            message: `CREATE TABLE ${rel?.relname ?? ''} without IF NOT EXISTS in expand phase`,
            hint: 'Use CREATE TABLE IF NOT EXISTS for idempotent expand migrations',
          });
        }
      },
      IndexStmt(node, ctx) {
        const ifNotExists = node.if_not_exists as boolean | undefined;
        if (!ifNotExists) {
          const idxname = node.idxname as string | undefined;
          ctx.report({
            message: `CREATE INDEX ${idxname ?? ''} without IF NOT EXISTS in expand phase`,
            hint: 'Use CREATE INDEX IF NOT EXISTS for idempotent expand migrations',
          });
        }
      },
    };
  },
};
