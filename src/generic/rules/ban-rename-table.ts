import type { GenericLintRule } from '../engine.js';

export const banRenameTable: GenericLintRule = {
  id: 'ban-rename-table',
  description: 'Renaming a table may break existing clients',
  create() {
    return {
      alter(node, ctx) {
        const exprs = node.expr as Array<Record<string, unknown>> | undefined;
        if (!exprs) return;
        for (const expr of exprs) {
          if (expr.action !== 'rename' || expr.resource !== 'table') continue;
          const tables = node.table as Array<{ table?: string }> | undefined;
          const newName = expr.table as string | undefined;
          ctx.report({
            message: `Renaming table "${tables?.[0]?.table ?? '(unknown)'}" to "${newName ?? '(unknown)'}"`,
            hint: 'Table renames break existing queries. Consider using a VIEW to alias the new name',
          });
        }
      },
    };
  },
};
