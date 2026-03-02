import type { LintRule } from './engine.js';

export const banTruncate: LintRule = {
  id: 'ban-truncate',
  description: 'TRUNCATE acquires ACCESS EXCLUSIVE lock and is irreversible',
  create() {
    return {
      TruncateStmt(_node, ctx) {
        ctx.report({
          message: 'TRUNCATE is not allowed in migrations',
          hint: 'Use DELETE with a WHERE clause, or manage data separately from schema migrations',
        });
      },
    };
  },
};
