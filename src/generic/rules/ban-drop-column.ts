import type { GenericLintRule } from '../engine.js';

export const banDropColumn: GenericLintRule = {
  id: 'ban-drop-column',
  description: 'DROP COLUMN is irreversible and may break dependent objects',
  create() {
    return {
      alter(node, ctx) {
        const exprs = node.expr as Array<Record<string, unknown>> | undefined;
        if (!exprs) return;
        for (const expr of exprs) {
          if (expr.action !== 'drop' || expr.resource !== 'column') continue;
          const tables = node.table as Array<{ table?: string }> | undefined;
          const col = expr.column as { column?: string } | undefined;
          ctx.report({
            message: `DROP COLUMN "${col?.column ?? '(unknown)'}" on "${tables?.[0]?.table ?? '(unknown)'}"`,
            hint: 'DROP COLUMN is irreversible. Consider deprecating the column first, then dropping in a later migration',
          });
        }
      },
    };
  },
};
