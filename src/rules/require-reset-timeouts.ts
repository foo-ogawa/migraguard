import type { LintRule } from './engine.js';

export const requireResetTimeouts: LintRule = {
  id: 'require-reset-timeouts',
  description: 'SET lock_timeout / statement_timeout must be followed by RESET',
  create() {
    let lockTimeoutSet = false;
    let stmtTimeoutSet = false;
    let lockTimeoutReset = false;
    let stmtTimeoutReset = false;

    return {
      VariableSetStmt(node) {
        const name = node.name as string;
        const kind = node.kind as string | undefined;
        if (kind === 'VAR_RESET' || kind === 'VAR_RESET_ALL') {
          if (name === 'lock_timeout') lockTimeoutReset = true;
          if (name === 'statement_timeout') stmtTimeoutReset = true;
          if (kind === 'VAR_RESET_ALL') {
            lockTimeoutReset = true;
            stmtTimeoutReset = true;
          }
          return;
        }
        if (name === 'lock_timeout') lockTimeoutSet = true;
        if (name === 'statement_timeout') stmtTimeoutSet = true;
      },

      _End(_node, ctx) {
        if (lockTimeoutSet && !lockTimeoutReset) {
          ctx.report({
            message: 'SET lock_timeout without RESET lock_timeout',
            hint: 'Add RESET lock_timeout; at the end of the file',
          });
        }
        if (stmtTimeoutSet && !stmtTimeoutReset) {
          ctx.report({
            message: 'SET statement_timeout without RESET statement_timeout',
            hint: 'Add RESET statement_timeout; at the end of the file',
          });
        }
      },
    };
  },
};
