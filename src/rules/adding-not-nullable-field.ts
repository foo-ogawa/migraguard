import type { LintRule } from './engine.js';

export const addingNotNullableField: LintRule = {
  id: 'adding-not-nullable-field',
  description: 'Adding a NOT NULL column requires a DEFAULT value',
  create() {
    return {
      AlterTableStmt(node, ctx) {
        const cmds = node.cmds as Array<Record<string, Record<string, unknown>>> | undefined;
        if (!cmds) return;

        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;

          const subtype = alterCmd.subtype as number | string | undefined;
          const isAddColumn = subtype === 'AT_AddColumn' || subtype === 0;
          if (!isAddColumn) continue;

          const colDef = alterCmd.def as Record<string, unknown> | undefined;
          if (!colDef?.ColumnDef) continue;

          const col = colDef.ColumnDef as Record<string, unknown>;
          const constraints = col.constraints as Array<Record<string, Record<string, unknown>>> | undefined;
          if (!constraints) continue;

          let hasNotNull = false;
          let hasDefault = false;

          for (const c of constraints) {
            const constr = c.Constraint;
            if (!constr) continue;
            if (constr.contype === 'CONSTR_NOTNULL') hasNotNull = true;
            if (constr.contype === 'CONSTR_DEFAULT') hasDefault = true;
          }

          if (hasNotNull && !hasDefault) {
            const colname = col.colname as string | undefined;
            ctx.report({
              message: `Adding NOT NULL column "${colname ?? '(unknown)'}" without DEFAULT`,
              hint: 'Add a DEFAULT value or add the column as nullable first, then backfill, then set NOT NULL',
            });
          }
        }
      },
    };
  },
};
