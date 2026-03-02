import type { LintRule } from './engine.js';

export const requirePkViaConcurrentIndex: LintRule = {
  id: 'require-pk-via-concurrent-index',
  description: 'PRIMARY KEY constraints should be added via CONCURRENTLY-created index',
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
          if (constr.contype !== 'CONSTR_PRIMARY') continue;

          if (!constr.indexname) {
            const rel = node.relation as { relname?: string } | undefined;
            ctx.report({
              message: `PRIMARY KEY added directly on "${rel?.relname ?? '(unknown)'}"`,
              hint: 'CREATE UNIQUE INDEX CONCURRENTLY first, then ADD CONSTRAINT ... PRIMARY KEY USING INDEX',
            });
          }
        }
      },
    };
  },
};
