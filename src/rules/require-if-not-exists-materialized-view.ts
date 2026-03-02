import type { LintRule } from './engine.js';

export const requireIfNotExistsMaterializedView: LintRule = {
  id: 'require-if-not-exists-materialized-view',
  description: 'CREATE MATERIALIZED VIEW must use IF NOT EXISTS',
  create() {
    return {
      CreateTableAsStmt(node, ctx) {
        if (node.objtype !== 'OBJECT_MATVIEW') return;
        if (!node.if_not_exists) {
          const into = node.into as { rel?: { relname?: string } } | undefined;
          const name = into?.rel?.relname ?? '(unknown)';
          ctx.report({
            message: `CREATE MATERIALIZED VIEW ${name} without IF NOT EXISTS`,
            hint: 'Use CREATE MATERIALIZED VIEW IF NOT EXISTS for idempotent migrations',
          });
        }
      },
    };
  },
};
