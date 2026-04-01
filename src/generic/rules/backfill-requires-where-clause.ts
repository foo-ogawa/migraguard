import type { GenericLintRule } from '../engine.js';

export const backfillRequiresWhereClause: GenericLintRule = {
  id: 'backfill-requires-where-clause',
  description: 'Backfill phase UPDATE/DELETE must have WHERE clause',
  applicablePhases: ['backfill'],
  create() {
    return {
      update(node, ctx) {
        if (node.where !== null && node.where !== undefined) return;
        const tables = node.table as Array<{ table?: string }> | undefined;
        ctx.report({
          message: `UPDATE on "${tables?.[0]?.table ?? '(unknown)'}" without WHERE clause in backfill phase`,
          hint: 'Add a WHERE clause to batch backfill operations safely',
        });
      },
      delete(node, ctx) {
        if (node.where !== null && node.where !== undefined) return;
        const from = node.from as Array<{ table?: string }> | undefined;
        ctx.report({
          message: `DELETE on "${from?.[0]?.table ?? '(unknown)'}" without WHERE clause in backfill phase`,
          hint: 'Add a WHERE clause to batch operations safely',
        });
      },
    };
  },
};
