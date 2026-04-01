import type { GenericLintRule } from '../engine.js';

export const banUpdateWithoutWhere: GenericLintRule = {
  id: 'ban-update-without-where',
  description: 'UPDATE without WHERE affects all rows',
  create() {
    return {
      update(node, ctx) {
        if (node.where !== null && node.where !== undefined) return;
        const tables = node.table as Array<{ table?: string }> | undefined;
        ctx.report({
          message: `UPDATE on "${tables?.[0]?.table ?? '(unknown)'}" without WHERE clause`,
          hint: 'Add a WHERE clause to limit affected rows',
        });
      },
    };
  },
};
