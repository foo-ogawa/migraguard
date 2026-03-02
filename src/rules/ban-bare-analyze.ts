import type { LintRule } from './engine.js';

export const banBareAnalyze: LintRule = {
  id: 'ban-bare-analyze',
  description: 'ANALYZE without table name analyzes the entire database',
  create() {
    return {
      VacuumStmt(node, ctx) {
        const rels = node.rels as Array<unknown> | undefined;
        if (!rels || rels.length === 0) {
          ctx.report({
            message: 'ANALYZE without table name',
            hint: 'Specify the target table: ANALYZE <table>; — bare ANALYZE scans the entire database',
          });
        }
      },
    };
  },
};
