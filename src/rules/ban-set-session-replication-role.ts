import type { LintRule } from './engine.js';

export const banSetSessionReplicationRole: LintRule = {
  id: 'ban-set-session-replication-role',
  description: 'Changing session_replication_role disables triggers and FK checks',
  create() {
    return {
      VariableSetStmt(node, ctx) {
        if (node.name !== 'session_replication_role') return;
        ctx.report({
          message: 'SET session_replication_role in migration',
          hint: 'Changing session_replication_role disables triggers and foreign key enforcement. This can silently corrupt data integrity',
        });
      },
    };
  },
};
