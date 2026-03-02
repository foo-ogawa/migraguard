import type { LintRule } from './engine.js';

export const banDropCascade: LintRule = {
  id: 'ban-drop-cascade',
  description: 'DROP ... CASCADE is dangerous — dependencies are silently dropped',
  create() {
    return {
      DropStmt(node, ctx) {
        if (node.behavior === 'DROP_CASCADE') {
          ctx.report({
            message: 'DROP with CASCADE',
            hint: 'Avoid CASCADE — drop dependent objects explicitly to maintain traceability',
          });
        }
      },
    };
  },
};
