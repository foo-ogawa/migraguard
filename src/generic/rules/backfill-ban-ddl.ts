import type { GenericLintRule } from '../engine.js';

export const backfillBanDdl: GenericLintRule = {
  id: 'backfill-ban-ddl',
  description: 'Backfill phase must not contain DDL statements',
  applicablePhases: ['backfill'],
  create() {
    return {
      create_table(_node, ctx) {
        ctx.report({
          message: 'CREATE TABLE is not allowed in backfill phase',
          hint: 'DDL changes belong in the expand or contract phase, not backfill',
        });
      },
      create_index(_node, ctx) {
        ctx.report({
          message: 'CREATE INDEX is not allowed in backfill phase',
          hint: 'DDL changes belong in the expand phase, not backfill',
        });
      },
      alter(_node, ctx) {
        ctx.report({
          message: 'ALTER TABLE is not allowed in backfill phase',
          hint: 'DDL changes belong in the expand or contract phase, not backfill',
        });
      },
      drop(_node, ctx) {
        ctx.report({
          message: 'DROP is not allowed in backfill phase',
          hint: 'DDL changes belong in the contract phase, not backfill',
        });
      },
    };
  },
};
