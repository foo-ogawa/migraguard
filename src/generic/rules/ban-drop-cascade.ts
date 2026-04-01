import type { GenericLintRule } from '../engine.js';

const CASCADE_RE = /\bDROP\s+(?:TABLE|INDEX|VIEW|SEQUENCE|FUNCTION|TRIGGER)\b[^;]*\bCASCADE\b/gi;

export const banDropCascade: GenericLintRule = {
  id: 'ban-drop-cascade',
  description: 'DROP ... CASCADE is dangerous — dependencies are silently dropped',
  create() {
    return {
      _End(_node, ctx) {
        CASCADE_RE.lastIndex = 0;
        if (CASCADE_RE.test(ctx.rawSql)) {
          ctx.report({
            message: 'DROP with CASCADE',
            hint: 'Avoid CASCADE — drop dependent objects explicitly to maintain traceability',
          });
        }
      },
    };
  },
};
