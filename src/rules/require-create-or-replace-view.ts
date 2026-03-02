import type { LintRule } from './engine.js';

export const requireCreateOrReplaceView: LintRule = {
  id: 'require-create-or-replace-view',
  description: 'CREATE VIEW must use CREATE OR REPLACE VIEW',
  create() {
    return {
      ViewStmt(node, ctx) {
        if (!node.replace) {
          const view = node.view as { relname?: string } | undefined;
          ctx.report({
            message: `CREATE VIEW ${view?.relname ?? ''} without OR REPLACE`,
            hint: 'Use CREATE OR REPLACE VIEW for idempotent migrations',
          });
        }
      },
    };
  },
};
