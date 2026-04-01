import { ALL_GENERIC_RULES } from '../../src/generic/rules/index.js';
import type { GenericLintRule, GenericDialect } from '../../src/generic/engine.js';
import { runGenericRules } from '../../src/generic/engine.js';
import type { RawViolation } from '../../src/generic/engine.js';

export function pick(...ids: string[]): GenericLintRule[] {
  return ALL_GENERIC_RULES.filter((r) => ids.includes(r.id));
}

export async function lint(
  sql: string,
  rules: GenericLintRule[],
  dialect: GenericDialect = 'mysql',
): Promise<RawViolation[]> {
  return runGenericRules(sql, rules, dialect);
}

export const DIALECTS: GenericDialect[] = ['mysql', 'sqlite'];
