import type { LintRule } from './engine.js';

export const requireAnalyzeAfterIndex: LintRule = {
  id: 'require-analyze-after-index',
  description: 'ANALYZE <table> should follow CREATE INDEX',
  create() {
    const tablesNeedingAnalyze = new Set<string>();

    return {
      IndexStmt(node) {
        const rel = node.relation as { relname?: string } | undefined;
        if (rel?.relname) tablesNeedingAnalyze.add(rel.relname);
      },

      VacuumStmt(node) {
        const rels = node.rels as Array<{ VacuumRelation?: { relation?: { relname?: string } } }> | undefined;
        if (!rels || rels.length === 0) return;
        for (const rel of rels) {
          const name = rel.VacuumRelation?.relation?.relname;
          if (name) tablesNeedingAnalyze.delete(name);
        }
      },

      _End(_node, ctx) {
        for (const table of tablesNeedingAnalyze) {
          ctx.report({
            message: `CREATE INDEX on "${table}" without subsequent ANALYZE ${table}`,
            hint: `Add ANALYZE ${table}; after index creation to update planner statistics`,
          });
        }
      },
    };
  },
};
