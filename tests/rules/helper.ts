import { ALL_RULES } from '../../src/rules/index.js';
import type { LintRule } from '../../src/rules/engine.js';

export function pick(...ids: string[]): LintRule[] {
  return ALL_RULES.filter((r) => ids.includes(r.id));
}
