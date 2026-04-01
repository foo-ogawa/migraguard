import type { GenericLintRule } from '../engine.js';

export const banDropTable: GenericLintRule = {
  id: 'ban-drop-table',
  description: 'DROP TABLE is irreversible and may break existing clients',
  create() {
    return {
      drop(node, ctx) {
        if (node.keyword !== 'table') return;
        const names = node.name as Array<{ table?: string }> | undefined;
        const tableNames = names?.map((n) => n.table).filter(Boolean);
        ctx.report({
          message: `DROP TABLE${tableNames?.length ? ` "${tableNames.join('", "')}"` : ''}`,
          hint: 'DROP TABLE is irreversible. Ensure the table is no longer referenced by application code before dropping',
        });
      },
    };
  },
};
