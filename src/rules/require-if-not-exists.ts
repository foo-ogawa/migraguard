import type { LintRule } from './engine.js';

export const requireIfNotExists: LintRule = {
  id: 'require-if-not-exists',
  description: 'CREATE must use IF NOT EXISTS, DROP must use IF EXISTS',
  create() {
    return {
      CreateStmt(node, ctx) {
        if (!node.if_not_exists) {
          const rel = node.relation as { relname?: string } | undefined;
          ctx.report({
            message: `CREATE TABLE ${rel?.relname ?? '(unknown)'} without IF NOT EXISTS`,
            hint: 'Use CREATE TABLE IF NOT EXISTS for idempotent migrations',
          });
        }
      },
      IndexStmt(node, ctx) {
        if (!node.if_not_exists) {
          ctx.report({
            message: 'CREATE INDEX without IF NOT EXISTS',
            hint: 'Use CREATE INDEX ... IF NOT EXISTS for idempotent migrations',
          });
        }
      },
      DropStmt(node, ctx) {
        if (!node.missing_ok) {
          ctx.report({
            message: 'DROP without IF EXISTS',
            hint: 'Use DROP ... IF EXISTS for idempotent migrations',
          });
        }
      },
    };
  },
};
