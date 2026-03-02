import type { LintRule } from './engine.js';

export const banDeleteWithoutWhere: LintRule = {
  id: 'ban-delete-without-where',
  description: 'DELETE without WHERE affects all rows',
  create() {
    return {
      DeleteStmt(node, ctx) {
        if (!node.whereClause) {
          const rel = node.relation as { relname?: string } | undefined;
          ctx.report({
            message: `DELETE on "${rel?.relname ?? '(unknown)'}" without WHERE clause`,
            hint: 'Add a WHERE clause to limit affected rows',
          });
        }
      },
    };
  },
};
