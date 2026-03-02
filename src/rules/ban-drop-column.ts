import type { LintRule } from './engine.js';

export const banDropColumn: LintRule = {
  id: 'ban-drop-column',
  description: 'DROP COLUMN is irreversible and may break dependent objects',
  create() {
    return {
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, Record<string, unknown>>> | undefined;
        if (!cmds) return;
        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;
          if (alterCmd.subtype === 'AT_DropColumn') {
            const rel = node.relation as { relname?: string } | undefined;
            ctx.report({
              message: `DROP COLUMN "${alterCmd.name}" on "${rel?.relname ?? '(unknown)'}"`,
              hint: 'DROP COLUMN is irreversible. Consider deprecating the column first, then dropping in a later migration',
            });
          }
        }
      },
    };
  },
};
