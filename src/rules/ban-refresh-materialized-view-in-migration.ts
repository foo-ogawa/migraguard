import type { LintRule } from './engine.js';

export const banRefreshMaterializedViewInMigration: LintRule = {
  id: 'ban-refresh-materialized-view-in-migration',
  description: 'REFRESH MATERIALIZED VIEW should not be in migration files',
  create() {
    return {
      RefreshMatViewStmt(node, ctx) {
        const rel = node.relation as { relname?: string } | undefined;
        const name = rel?.relname ?? '(unknown)';
        ctx.report({
          message: `REFRESH MATERIALIZED VIEW ${name} in migration`,
          hint: 'REFRESH is a heavy operation — run it as a separate job, not in schema migrations',
        });
      },
    };
  },
};
