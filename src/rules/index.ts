export { runRules } from './engine.js';
export type { LintRule, LintViolation, RawViolation, RuleReport, RuleContext, NodeVisitors } from './engine.js';

import { requireConcurrentIndex } from './require-concurrent-index.js';
import { requireIfNotExists } from './require-if-not-exists.js';
import { requireLockTimeout } from './require-lock-timeout.js';
import { banConcurrentIndexInTransaction } from './ban-concurrent-index-in-transaction.js';
import { addingNotNullableField } from './adding-not-nullable-field.js';
import { constraintMissingNotValid } from './constraint-missing-not-valid.js';
import { requireAnalyzeAfterIndex } from './require-analyze-after-index.js';
import { requireCreateOrReplaceView } from './require-create-or-replace-view.js';
import { banDropCascade } from './ban-drop-cascade.js';
import { requireStatementTimeout } from './require-statement-timeout.js';
import { requireResetTimeouts } from './require-reset-timeouts.js';
import { banTruncate } from './ban-truncate.js';
import { banUpdateWithoutWhere } from './ban-update-without-where.js';
import { banDeleteWithoutWhere } from './ban-delete-without-where.js';
import { banDropColumn } from './ban-drop-column.js';
import { banAlterColumnType } from './ban-alter-column-type.js';
import { requireDropIndexConcurrently } from './require-drop-index-concurrently.js';
import { requireUniqueViaConcurrentIndex } from './require-unique-via-concurrent-index.js';
import { banValidateConstraintSameFile } from './ban-validate-constraint-same-file.js';
import { banBareAnalyze } from './ban-bare-analyze.js';
import type { LintRule } from './engine.js';

export const ALL_RULES: LintRule[] = [
  requireConcurrentIndex,
  requireIfNotExists,
  requireLockTimeout,
  banConcurrentIndexInTransaction,
  addingNotNullableField,
  constraintMissingNotValid,
  requireAnalyzeAfterIndex,
  requireCreateOrReplaceView,
  banDropCascade,
  requireStatementTimeout,
  requireResetTimeouts,
  banTruncate,
  banUpdateWithoutWhere,
  banDeleteWithoutWhere,
  banDropColumn,
  banAlterColumnType,
  requireDropIndexConcurrently,
  requireUniqueViaConcurrentIndex,
  banValidateConstraintSameFile,
  banBareAnalyze,
];
