import type { LintRule } from './engine.js';

export const backfillBanDdl: LintRule = {
  id: 'backfill-ban-ddl',
  description: 'Backfill phase must not contain DDL statements',
  applicablePhases: ['backfill'],
  create() {
    return {
      CreateStmt(_node, ctx) {
        ctx.report({
          message: 'CREATE TABLE is not allowed in backfill phase',
          hint: 'DDL changes belong in the expand or contract phase, not backfill',
        });
      },
      AlterTableStmt(_node, ctx) {
        ctx.report({
          message: 'ALTER TABLE is not allowed in backfill phase',
          hint: 'DDL changes belong in the expand or contract phase, not backfill',
        });
      },
      IndexStmt(_node, ctx) {
        ctx.report({
          message: 'CREATE INDEX is not allowed in backfill phase',
          hint: 'DDL changes belong in the expand phase, not backfill',
        });
      },
      DropStmt(_node, ctx) {
        ctx.report({
          message: 'DROP is not allowed in backfill phase',
          hint: 'DDL changes belong in the contract phase, not backfill',
        });
      },
    };
  },
};
