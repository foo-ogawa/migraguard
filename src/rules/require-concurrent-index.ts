import type { LintRule } from './engine.js';

export const requireConcurrentIndex: LintRule = {
  id: 'require-concurrent-index',
  description: 'CREATE INDEX must use CONCURRENTLY on existing tables',
  create() {
    return {
      IndexStmt(node, ctx) {
        const rel = node.relation as { relname?: string } | undefined;
        const tableName = rel?.relname ?? '(unknown)';
        const isNewTable = ctx.createdTables.has(tableName);
        if (!node.concurrent && !isNewTable) {
          ctx.report({
            message: `CREATE INDEX on "${tableName}" without CONCURRENTLY`,
            hint: 'Use CREATE INDEX CONCURRENTLY to avoid blocking writes',
          });
        }
      },
    };
  },
};
