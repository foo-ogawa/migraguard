/** @type {import('migraguard').LintRule} */
export default {
  id: 'require-fk-column-suffix',
  description: 'Foreign key columns must end with _id',
  create() {
    return {
      CreateStmt(node, ctx) {
        const tableElts = node.tableElts;
        if (!Array.isArray(tableElts)) return;

        for (const elt of tableElts) {
          if (!elt.ColumnDef) continue;
          const col = elt.ColumnDef;
          const colname = col.colname;
          const constraints = col.constraints;
          if (!Array.isArray(constraints)) continue;

          const hasFk = constraints.some(
            (c) => c.Constraint && c.Constraint.contype === 'CONSTR_FOREIGN',
          );
          if (hasFk && typeof colname === 'string' && !colname.endsWith('_id')) {
            ctx.report({
              message: `FK column "${colname}" does not end with _id`,
              hint: `Rename to "${colname}_id" or another name ending with _id`,
            });
          }
        }
      },

      AlterTableStmt(node, ctx) {
        const cmds = node.cmds;
        if (!Array.isArray(cmds)) return;

        for (const cmd of cmds) {
          const alterCmd = cmd.AlterTableCmd;
          if (!alterCmd) continue;

          const def = alterCmd.def;
          if (!def || !def.Constraint) continue;

          const constr = def.Constraint;
          if (constr.contype !== 'CONSTR_FOREIGN') continue;

          const fkAttrs = constr.fk_attrs;
          if (!Array.isArray(fkAttrs)) continue;

          for (const attr of fkAttrs) {
            const colname = attr.String?.sval;
            if (typeof colname === 'string' && !colname.endsWith('_id')) {
              ctx.report({
                message: `FK column "${colname}" does not end with _id`,
                hint: `Rename to "${colname}_id" or another name ending with _id`,
              });
            }
          }
        }
      },
    };
  },
};
