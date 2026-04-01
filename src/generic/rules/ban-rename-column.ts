import type { GenericLintRule } from '../engine.js';

export const banRenameColumn: GenericLintRule = {
  id: 'ban-rename-column',
  description: 'Renaming a column may break existing clients',
  create() {
    return {
      alter(node, ctx) {
        const exprs = node.expr as Array<Record<string, unknown>> | undefined;
        if (!exprs) return;
        for (const expr of exprs) {
          if (expr.action !== 'rename' || expr.resource !== 'column') continue;
          const tables = node.table as Array<{ table?: string }> | undefined;
          const oldCol = expr.old_column as { column?: string } | undefined;
          const newCol = expr.column as { column?: string } | undefined;
          ctx.report({
            message: `Renaming column "${oldCol?.column ?? '(unknown)'}" to "${newCol?.column ?? '(unknown)'}" on "${tables?.[0]?.table ?? '(unknown)'}"`,
            hint: 'Column renames break existing queries and application code. Consider adding a new column and deprecating the old one',
          });
        }
      },
    };
  },
};
