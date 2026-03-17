import type { LintRule } from './engine.js';

export const backfillRequiresWhereClause: LintRule = {
  id: 'backfill-requires-where-clause',
  description: 'Backfill UPDATE/DELETE must include a WHERE clause',
  applicablePhases: ['backfill'],
  create() {
    return {
      UpdateStmt(node, ctx) {
        if (!node.whereClause) {
          ctx.report({
            message: 'UPDATE without WHERE clause in backfill phase',
            hint: 'Add a WHERE clause to ensure backfill is incremental and idempotent',
          });
        }
      },
      DeleteStmt(node, ctx) {
        if (!node.whereClause) {
          ctx.report({
            message: 'DELETE without WHERE clause in backfill phase',
            hint: 'Add a WHERE clause to target specific rows in backfill',
          });
        }
      },
    };
  },
};
