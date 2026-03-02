import type { LintRule } from './engine.js';

export const banCluster: LintRule = {
  id: 'ban-cluster',
  description: 'CLUSTER rewrites the table with ACCESS EXCLUSIVE lock',
  create() {
    return {
      ClusterStmt(node, ctx) {
        const rel = node.relation as { relname?: string } | undefined;
        ctx.report({
          message: `CLUSTER${rel?.relname ? ` on "${rel.relname}"` : ''} in migration`,
          hint: 'CLUSTER rewrites the entire table under ACCESS EXCLUSIVE lock. Run it as a separate operational job, not in migrations',
        });
      },
    };
  },
};
