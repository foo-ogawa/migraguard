import type { GenericLintRule } from '../engine.js';

export const banTruncate: GenericLintRule = {
  id: 'ban-truncate',
  description: 'TRUNCATE is irreversible',
  create() {
    return {
      truncate(_node, ctx) {
        ctx.report({
          message: 'TRUNCATE is not allowed in migrations',
          hint: 'Use DELETE with a WHERE clause, or manage data separately from schema migrations',
        });
      },
    };
  },
};
