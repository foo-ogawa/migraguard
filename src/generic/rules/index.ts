export { runGenericRules } from '../engine.js';
export type { GenericLintRule, GenericRuleContext, GenericNodeVisitors, GenericDialect } from '../engine.js';

import { requireIfNotExists } from './require-if-not-exists.js';
import { banDropColumn } from './ban-drop-column.js';
import { banAlterColumnType } from './ban-alter-column-type.js';
import { banRenameColumn } from './ban-rename-column.js';
import { banRenameTable } from './ban-rename-table.js';
import { banDropTable } from './ban-drop-table.js';
import { banUpdateWithoutWhere } from './ban-update-without-where.js';
import { banDeleteWithoutWhere } from './ban-delete-without-where.js';
import { banTruncate } from './ban-truncate.js';
import { addingNotNullableField } from './adding-not-nullable-field.js';
import { requireCreateOrReplaceView } from './require-create-or-replace-view.js';
import { banSelectStarInView } from './ban-select-star-in-view.js';
import { banDropCascade } from './ban-drop-cascade.js';
import { backfillRequiresWhereClause } from './backfill-requires-where-clause.js';
import { backfillBanDdl } from './backfill-ban-ddl.js';
import { contractRequiresAllowDirective } from './contract-requires-allow-directive.js';
import { expandRequiresIdempotentPattern } from './expand-requires-idempotent-pattern.js';
import type { GenericLintRule } from '../engine.js';

export const ALL_GENERIC_RULES: GenericLintRule[] = [
  requireIfNotExists,
  banDropColumn,
  banAlterColumnType,
  banRenameColumn,
  banRenameTable,
  banDropTable,
  banUpdateWithoutWhere,
  banDeleteWithoutWhere,
  banTruncate,
  addingNotNullableField,
  requireCreateOrReplaceView,
  banSelectStarInView,
  banDropCascade,
  backfillRequiresWhereClause,
  backfillBanDdl,
  contractRequiresAllowDirective,
  expandRequiresIdempotentPattern,
];
