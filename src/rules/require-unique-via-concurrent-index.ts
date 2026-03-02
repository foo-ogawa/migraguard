import type { LintRule } from './engine.js';

export const requireUniqueViaConcurrentIndex: LintRule = {
  id: 'require-unique-via-concurrent-index',
  description: 'UNIQUE constraints should be added via CONCURRENTLY-created index',
  create() {
    return {
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, Record<string, unknown>>> | undefined;
        if (!cmds) return;
        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;
          if (alterCmd.subtype !== 'AT_AddConstraint') continue;

          const def = alterCmd.def as Record<string, unknown> | undefined;
          if (!def?.Constraint) continue;

          const constr = def.Constraint as Record<string, unknown>;
          if (constr.contype !== 'CONSTR_UNIQUE') continue;

          if (!constr.indexname) {
            const conname = constr.conname as string | undefined;
            ctx.report({
              message: `UNIQUE constraint ${conname ? `"${conname}" ` : ''}added directly`,
              hint: 'Create a UNIQUE index CONCURRENTLY first, then ADD CONSTRAINT ... USING INDEX',
            });
          }
        }
      },
    };
  },
};
