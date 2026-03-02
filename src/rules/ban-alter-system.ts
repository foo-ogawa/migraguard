import type { LintRule } from './engine.js';

export const banAlterSystem: LintRule = {
  id: 'ban-alter-system',
  description: 'ALTER SYSTEM modifies postgresql.conf and should not be in migrations',
  create() {
    return {
      AlterSystemStmt(_node, ctx) {
        ctx.report({
          message: 'ALTER SYSTEM in migration',
          hint: 'ALTER SYSTEM writes to postgresql.auto.conf and affects the entire cluster. Manage server settings via configuration management, not migrations',
        });
      },
    };
  },
};
