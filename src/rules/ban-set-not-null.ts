import type { LintRule } from './engine.js';

export const banSetNotNull: LintRule = {
  id: 'ban-set-not-null',
  description: 'SET NOT NULL acquires ACCESS EXCLUSIVE lock and scans all rows',
  create() {
    return {
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, Record<string, unknown>>> | undefined;
        if (!cmds) return;
        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;
          if (alterCmd.subtype !== 'AT_SetNotNull') continue;

          const rel = node.relation as { relname?: string } | undefined;
          ctx.report({
            message: `SET NOT NULL on "${rel?.relname ?? '(unknown)'}".${alterCmd.name as string}`,
            hint: 'Use ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID, then VALIDATE in a separate migration, then SET NOT NULL',
          });
        }
      },
    };
  },
};
