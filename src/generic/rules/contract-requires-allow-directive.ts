import type { GenericLintRule } from '../engine.js';

export const contractRequiresAllowDirective: GenericLintRule = {
  id: 'contract-requires-allow-directive',
  description: 'Contract phase DROP operations must have migraguard:allow directives',
  applicablePhases: ['contract'],
  create() {
    return {
      drop(node, ctx) {
        const keyword = node.keyword as string | undefined;
        if (keyword === 'table' || keyword === 'index') {
          ctx.report({
            message: 'DROP statement in contract phase requires explicit migraguard:allow directive',
            hint: 'Add "-- migraguard:allow ban-drop-table" or similar before this statement',
          });
        }
      },
      alter(node, ctx) {
        const exprs = node.expr as Array<Record<string, unknown>> | undefined;
        if (!exprs) return;
        for (const expr of exprs) {
          if (expr.action === 'drop' && expr.resource === 'column') {
            ctx.report({
              message: 'ALTER TABLE DROP COLUMN in contract phase requires explicit migraguard:allow directive',
              hint: 'Add "-- migraguard:allow ban-drop-column" before this statement',
            });
          }
        }
      },
    };
  },
};
