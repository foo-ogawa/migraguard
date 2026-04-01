import type { GenericLintRule } from '../engine.js';

export const requireCreateOrReplaceView: GenericLintRule = {
  id: 'require-create-or-replace-view',
  description: 'CREATE VIEW should use CREATE OR REPLACE VIEW (or IF NOT EXISTS for SQLite)',
  create() {
    return {
      create_view(node, ctx) {
        if (node.replace) return;
        if (node.if_not_exists) return;
        const view = node.view as { view?: string } | undefined;
        ctx.report({
          message: `CREATE VIEW ${view?.view ?? ''} without OR REPLACE / IF NOT EXISTS`,
          hint: 'Use CREATE OR REPLACE VIEW (MySQL) or CREATE VIEW IF NOT EXISTS (SQLite) for idempotent migrations',
        });
      },
    };
  },
};
