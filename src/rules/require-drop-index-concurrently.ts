import type { LintRule } from './engine.js';

export const requireDropIndexConcurrently: LintRule = {
  id: 'require-drop-index-concurrently',
  description: 'DROP INDEX must use CONCURRENTLY to avoid blocking writes',
  create() {
    return {
      DropStmt(node, ctx) {
        if (node.removeType !== 'OBJECT_INDEX') return;
        if (!node.concurrent) {
          ctx.report({
            message: 'DROP INDEX without CONCURRENTLY',
            hint: 'Use DROP INDEX CONCURRENTLY to avoid blocking writes',
          });
        }
      },
    };
  },
};
