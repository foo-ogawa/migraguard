import type { LintRule } from './engine.js';

export const banRenameTable: LintRule = {
  id: 'ban-rename-table',
  description: 'Renaming a table may break existing clients',
  create() {
    return {
      RenameStmt(node, ctx) {
        if (node.renameType !== 'OBJECT_TABLE') return;
        const rel = node.relation as { relname?: string } | undefined;
        ctx.report({
          message: `Renaming table "${rel?.relname ?? '(unknown)'}" to "${node.newname}"`,
          hint: 'Table renames break existing queries. Consider using a VIEW to alias the new name',
        });
      },
    };
  },
};
