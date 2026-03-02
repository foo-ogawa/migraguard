import type { LintRule } from './engine.js';

export const banVacuumFull: LintRule = {
  id: 'ban-vacuum-full',
  description: 'VACUUM FULL rewrites the table with ACCESS EXCLUSIVE lock',
  create() {
    return {
      VacuumStmt(node, ctx) {
        if (!node.is_vacuumcmd) return;
        const options = node.options as Array<{ DefElem?: { defname?: string } }> | undefined;
        const hasFull = options?.some((o) => o.DefElem?.defname === 'full');
        if (hasFull) {
          ctx.report({
            message: 'VACUUM FULL in migration',
            hint: 'VACUUM FULL rewrites the entire table under ACCESS EXCLUSIVE lock. Run it as a separate operational job, not in migrations',
          });
        }
      },
    };
  },
};
