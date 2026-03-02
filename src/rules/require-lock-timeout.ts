import type { LintRule } from './engine.js';

export const requireLockTimeout: LintRule = {
  id: 'require-lock-timeout',
  description: 'SET lock_timeout must appear before DDL statements',
  create() {
    let flagged = false;

    function checkTimeout(ctx: Parameters<NonNullable<import('./engine.js').NodeVisitors['CreateStmt']>>[1]): void {
      if (!ctx.lockTimeoutSet && !flagged) {
        flagged = true;
        ctx.report({
          message: 'DDL appears before SET lock_timeout',
          hint: "Add SET lock_timeout = '5s'; before DDL statements",
        });
      }
    }

    return {
      CreateStmt(_node, ctx) {
        checkTimeout(ctx);
      },
      IndexStmt(node, ctx) {
        if (!node.concurrent) checkTimeout(ctx);
      },
      AlterTableStmt(_node, ctx) {
        checkTimeout(ctx);
      },
      DropStmt(_node, ctx) {
        checkTimeout(ctx);
      },
    };
  },
};
