import type { GenericLintRule } from '../engine.js';

export const addingNotNullableField: GenericLintRule = {
  id: 'adding-not-nullable-field',
  description: 'Adding a NOT NULL column requires a DEFAULT value',
  create() {
    return {
      alter(node, ctx) {
        const exprs = node.expr as Array<Record<string, unknown>> | undefined;
        if (!exprs) return;

        for (const expr of exprs) {
          if (expr.action !== 'add' || expr.resource !== 'column') continue;

          const nullable = expr.nullable as { type?: string } | undefined;
          const hasNotNull = nullable?.type === 'not null';
          const hasDefault = expr.default_val !== undefined && expr.default_val !== null;

          if (hasNotNull && !hasDefault) {
            const col = expr.column as { column?: string } | undefined;
            ctx.report({
              message: `Adding NOT NULL column "${col?.column ?? '(unknown)'}" without DEFAULT`,
              hint: 'Add a DEFAULT value or add the column as nullable first, then backfill, then set NOT NULL',
            });
          }
        }
      },
    };
  },
};
