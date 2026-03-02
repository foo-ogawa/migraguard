import type { LintRule } from './engine.js';

export const requireStatementTimeout: LintRule = {
  id: 'require-statement-timeout',
  description: 'SET statement_timeout must appear before DDL statements',
  create() {
    let set = false;
    let flagged = false;

    function check(ctx: Parameters<NonNullable<import('./engine.js').NodeVisitors[string]>>[1]): void {
      if (!set && !flagged) {
        flagged = true;
        ctx.report({
          message: 'DDL appears before SET statement_timeout',
          hint: "Add SET statement_timeout = '30s'; before DDL statements",
        });
      }
    }

    return {
      VariableSetStmt(node) {
        if ((node.name as string) === 'statement_timeout') set = true;
      },
      CreateStmt(_node, ctx) { check(ctx); },
      IndexStmt(node, ctx) { if (!node.concurrent) check(ctx); },
      AlterTableStmt(_node, ctx) { check(ctx); },
      DropStmt(_node, ctx) { check(ctx); },
    };
  },
};
