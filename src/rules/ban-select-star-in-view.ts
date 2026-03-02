import type { LintRule } from './engine.js';

function hasStarInTargetList(targetList: unknown): boolean {
  if (!Array.isArray(targetList)) return false;
  for (const item of targetList) {
    const resTarget = (item as Record<string, Record<string, unknown>>).ResTarget;
    if (!resTarget) continue;
    const val = resTarget.val as Record<string, Record<string, unknown>> | undefined;
    if (!val?.ColumnRef) continue;
    const fields = val.ColumnRef.fields as Array<Record<string, unknown>> | undefined;
    if (!fields) continue;
    if (fields.some((f) => 'A_Star' in f)) return true;
  }
  return false;
}

export const banSelectStarInView: LintRule = {
  id: 'ban-select-star-in-view',
  description: 'SELECT * in VIEW definitions makes schema changes unsafe',
  create() {
    return {
      ViewStmt(node, ctx) {
        const query = node.query as Record<string, Record<string, unknown>> | undefined;
        const selectStmt = query?.SelectStmt;
        if (!selectStmt) return;
        if (hasStarInTargetList(selectStmt.targetList)) {
          const view = node.view as { relname?: string } | undefined;
          ctx.report({
            message: `SELECT * in VIEW "${view?.relname ?? '(unknown)'}"`,
            hint: 'List columns explicitly — SELECT * breaks CREATE OR REPLACE VIEW when base table columns change',
          });
        }
      },

      CreateTableAsStmt(node, ctx) {
        if (node.objtype !== 'OBJECT_MATVIEW') return;
        const query = node.query as Record<string, Record<string, unknown>> | undefined;
        const selectStmt = query?.SelectStmt;
        if (!selectStmt) return;
        if (hasStarInTargetList(selectStmt.targetList)) {
          const into = node.into as { rel?: { relname?: string } } | undefined;
          const name = into?.rel?.relname ?? '(unknown)';
          ctx.report({
            message: `SELECT * in MATERIALIZED VIEW "${name}"`,
            hint: 'List columns explicitly — SELECT * makes schema evolution unpredictable',
          });
        }
      },
    };
  },
};
