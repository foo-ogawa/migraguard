import type { GenericLintRule } from '../engine.js';

export const banAlterColumnType: GenericLintRule = {
  id: 'ban-alter-column-type',
  description: 'ALTER COLUMN TYPE may rewrite the table and acquire long locks',
  create() {
    return {
      alter(node, ctx) {
        const exprs = node.expr as Array<Record<string, unknown>> | undefined;
        if (!exprs) return;
        for (const expr of exprs) {
          if (expr.action !== 'modify') continue;
          const tables = node.table as Array<{ table?: string }> | undefined;
          const col = expr.column as { column?: string } | undefined;
          ctx.report({
            message: `ALTER COLUMN TYPE on "${tables?.[0]?.table ?? '(unknown)'}".${col?.column ?? '(unknown)'}`,
            hint: 'Type changes may rewrite the table. Use add-column → backfill → swap → drop-column instead',
          });
        }
      },
    };
  },
};
