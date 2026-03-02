import type { LintRule } from './engine.js';

export const banUpdateWithoutWhere: LintRule = {
  id: 'ban-update-without-where',
  description: 'UPDATE without WHERE affects all rows',
  create() {
    return {
      UpdateStmt(node, ctx) {
        if (!node.whereClause) {
          const rel = node.relation as { relname?: string } | undefined;
          ctx.report({
            message: `UPDATE on "${rel?.relname ?? '(unknown)'}" without WHERE clause`,
            hint: 'Add a WHERE clause to limit affected rows',
          });
        }
      },
    };
  },
};
