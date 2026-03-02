import type { LintRule } from './engine.js';

export const banReindex: LintRule = {
  id: 'ban-reindex',
  description: 'REINDEX acquires heavy locks and should be run as an operational job',
  create() {
    return {
      ReindexStmt(node, ctx) {
        const rel = node.relation as { relname?: string } | undefined;
        ctx.report({
          message: `REINDEX${rel?.relname ? ` "${rel.relname}"` : ''} in migration`,
          hint: 'REINDEX acquires ACCESS EXCLUSIVE (or SHARE lock for CONCURRENTLY). Run it as a separate operational job, not in migrations',
        });
      },
    };
  },
};
