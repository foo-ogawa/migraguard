import type { GenericLintRule } from '../engine.js';

export const banDeleteWithoutWhere: GenericLintRule = {
  id: 'ban-delete-without-where',
  description: 'DELETE without WHERE affects all rows',
  create() {
    return {
      delete(node, ctx) {
        if (node.where !== null && node.where !== undefined) return;
        const from = node.from as Array<{ table?: string }> | undefined;
        ctx.report({
          message: `DELETE on "${from?.[0]?.table ?? '(unknown)'}" without WHERE clause`,
          hint: 'Add a WHERE clause to limit affected rows',
        });
      },
    };
  },
};
