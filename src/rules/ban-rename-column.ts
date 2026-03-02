import type { LintRule } from './engine.js';

export const banRenameColumn: LintRule = {
  id: 'ban-rename-column',
  description: 'Renaming a column may break existing clients',
  create() {
    return {
      RenameStmt(node, ctx) {
        if (node.renameType !== 'OBJECT_COLUMN') return;
        const rel = node.relation as { relname?: string } | undefined;
        ctx.report({
          message: `Renaming column "${node.subname}" to "${node.newname}" on "${rel?.relname ?? '(unknown)'}"`,
          hint: 'Column renames break existing queries and application code. Consider adding a new column and deprecating the old one',
        });
      },
    };
  },
};
