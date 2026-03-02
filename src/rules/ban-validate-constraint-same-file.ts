import type { LintRule } from './engine.js';

export const banValidateConstraintSameFile: LintRule = {
  id: 'ban-validate-constraint-same-file',
  description: 'VALIDATE CONSTRAINT should be in a separate migration from NOT VALID',
  create() {
    const notValidConstraints = new Set<string>();

    return {
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, Record<string, unknown>>> | undefined;
        if (!cmds) return;
        const rel = node.relation as { relname?: string } | undefined;
        const table = rel?.relname ?? '';

        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;

          if (alterCmd.subtype === 'AT_AddConstraint') {
            const def = alterCmd.def as Record<string, unknown> | undefined;
            if (!def?.Constraint) continue;
            const constr = def.Constraint as Record<string, unknown>;
            if (constr.skip_validation) {
              const conname = constr.conname as string | undefined;
              if (conname) notValidConstraints.add(`${table}.${conname}`);
            }
          }

          if (alterCmd.subtype === 'AT_ValidateConstraint') {
            const conname = alterCmd.name as string | undefined;
            const key = `${table}.${conname}`;
            if (conname && notValidConstraints.has(key)) {
              ctx.report({
                message: `VALIDATE CONSTRAINT "${conname}" in same file as NOT VALID`,
                hint: 'Move VALIDATE CONSTRAINT to a separate migration to control timing and avoid long locks during high traffic',
              });
            }
          }
        }
      },
    };
  },
};
