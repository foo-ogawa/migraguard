export { runRules } from './engine.js';
export type { LintRule, LintViolation, RuleContext, NodeVisitors } from './engine.js';

import { requireConcurrentIndex } from './require-concurrent-index.js';
import { requireIfNotExists } from './require-if-not-exists.js';
import { requireLockTimeout } from './require-lock-timeout.js';
import { banConcurrentIndexInTransaction } from './ban-concurrent-index-in-transaction.js';
import { addingNotNullableField } from './adding-not-nullable-field.js';
import { constraintMissingNotValid } from './constraint-missing-not-valid.js';
import type { LintRule } from './engine.js';

export const ALL_RULES: LintRule[] = [
  requireConcurrentIndex,
  requireIfNotExists,
  requireLockTimeout,
  banConcurrentIndexInTransaction,
  addingNotNullableField,
  constraintMissingNotValid,
];
