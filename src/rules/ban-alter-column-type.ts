import type { LintRule } from './engine.js';

export const banAlterColumnType: LintRule = {
  id: 'ban-alter-column-type',
  description: 'ALTER COLUMN TYPE may rewrite the table and acquire long locks',
  create() {
    return {
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, Record<string, unknown>>> | undefined;
        if (!cmds) return;
        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;
          if (alterCmd.subtype === 'AT_AlterColumnType') {
            const rel = node.relation as { relname?: string } | undefined;
            ctx.report({
              message: `ALTER COLUMN TYPE on "${rel?.relname ?? '(unknown)'}".${alterCmd.name as string}`,
              hint: 'Type changes may rewrite the table. Use add-column → backfill → swap → drop-column instead',
            });
          }
        }
      },
    };
  },
};
