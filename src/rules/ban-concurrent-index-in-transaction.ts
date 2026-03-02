import type { LintRule } from './engine.js';

export const banConcurrentIndexInTransaction: LintRule = {
  id: 'ban-concurrent-index-in-transaction',
  description: 'CREATE INDEX CONCURRENTLY cannot run inside a transaction',
  create() {
    return {
      IndexStmt(node, ctx) {
        if (node.concurrent && ctx.inTransaction) {
          ctx.report({
            message: 'CREATE INDEX CONCURRENTLY inside a transaction',
            hint: 'Remove BEGIN/COMMIT — CONCURRENTLY cannot run inside a transaction block',
          });
        }
      },
    };
  },
};
