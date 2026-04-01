import type { GenericLintRule } from '../engine.js';

function hasSelectStar(select: Record<string, unknown>): boolean {
  const columns = select.columns as Array<Record<string, unknown>> | undefined;
  if (!columns) return false;
  for (const col of columns) {
    const expr = col.expr as { column?: string } | undefined;
    if (expr?.column === '*') return true;
  }
  return false;
}

export const banSelectStarInView: GenericLintRule = {
  id: 'ban-select-star-in-view',
  description: 'SELECT * in VIEW definitions makes schema changes unsafe',
  create() {
    return {
      create_view(node, ctx) {
        const select = node.select as Record<string, unknown> | undefined;
        if (!select) return;
        if (!hasSelectStar(select)) return;
        const view = node.view as { view?: string } | undefined;
        ctx.report({
          message: `SELECT * in VIEW "${view?.view ?? '(unknown)'}"`,
          hint: 'List columns explicitly — SELECT * breaks migrations when base table columns change',
        });
      },
    };
  },
};
