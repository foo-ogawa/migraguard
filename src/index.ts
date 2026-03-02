import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const VERSION: string = pkg.version;
export type { LintRule, LintViolation, RuleReport, RuleContext, NodeVisitors } from './rules/engine.js';
