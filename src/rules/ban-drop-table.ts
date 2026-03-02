import type { LintRule } from './engine.js';

export const banDropTable: LintRule = {
  id: 'ban-drop-table',
  description: 'DROP TABLE is irreversible and may break existing clients',
  create() {
    return {
      DropStmt(node, ctx) {
        if (node.removeType !== 'OBJECT_TABLE') return;
        const objects = node.objects as Array<{ List?: { items?: Array<{ String?: { sval?: string } }> } }> | undefined;
        const names = objects
          ?.map((o) => o.List?.items?.map((i) => i.String?.sval).filter(Boolean).join('.'))
          .filter(Boolean);
        ctx.report({
          message: `DROP TABLE${names?.length ? ` "${names.join('", "')}"` : ''}`,
          hint: 'DROP TABLE is irreversible. Ensure the table is no longer referenced by application code before dropping',
        });
      },
    };
  },
};
