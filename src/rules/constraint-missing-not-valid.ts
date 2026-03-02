import type { LintRule } from './engine.js';

export const constraintMissingNotValid: LintRule = {
  id: 'constraint-missing-not-valid',
  description: 'ADD CONSTRAINT should use NOT VALID to avoid full table scan',
  create() {
    return {
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, Record<string, unknown>>> | undefined;
        if (!cmds) return;

        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;

          const subtype = alterCmd.subtype as number | string | undefined;
          const isAddConstraint = subtype === 'AT_AddConstraint' || subtype === 14;
          if (!isAddConstraint) continue;

          const def = alterCmd.def as Record<string, unknown> | undefined;
          if (!def?.Constraint) continue;

          const constr = def.Constraint as Record<string, unknown>;
          const contype = constr.contype as string | undefined;

          const needsNotValid = contype === 'CONSTR_FOREIGN' || contype === 'CONSTR_CHECK';
          if (!needsNotValid) continue;

          if (!constr.skip_validation) {
            const conname = constr.conname as string | undefined;
            ctx.report({
              message: `ADD CONSTRAINT ${conname ? `"${conname}" ` : ''}without NOT VALID`,
              hint: 'Use NOT VALID to avoid a full table scan that blocks writes, then VALIDATE CONSTRAINT separately',
            });
          }
        }
      },
    };
  },
};
