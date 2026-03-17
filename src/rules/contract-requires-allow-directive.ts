import type { LintRule } from './engine.js';

export const contractRequiresAllowDirective: LintRule = {
  id: 'contract-requires-allow-directive',
  description: 'Contract phase DROP operations must have migraguard:allow directives',
  applicablePhases: ['contract'],
  create() {
    return {
      DropStmt(node, ctx) {
        const removeType = node.removeType as string | undefined;
        if (removeType === 'OBJECT_TABLE' || removeType === 'OBJECT_INDEX') {
          ctx.report({
            message: `DROP statement in contract phase requires explicit migraguard:allow directive`,
            hint: 'Add "-- migraguard:allow ban-drop-table" or "-- migraguard:allow ban-drop-column" before this statement',
          });
        }
      },
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, unknown>> | undefined;
        if (!cmds) return;
        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd as Record<string, unknown> | undefined;
          if (!alterCmd) continue;
          const subtype = alterCmd.subtype as string | undefined;
          if (subtype === 'AT_DropColumn') {
            ctx.report({
              message: 'ALTER TABLE DROP COLUMN in contract phase requires explicit migraguard:allow directive',
              hint: 'Add "-- migraguard:allow ban-drop-column" before this statement',
            });
          }
        }
      },
    };
  },
};
