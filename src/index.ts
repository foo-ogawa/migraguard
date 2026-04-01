import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const pkg = require('../package.json') as {
  name: string;
  version: string;
  description: string;
};

export const VERSION: string = pkg.version;
export type { LintRule, LintViolation, RuleReport, RuleContext, NodeVisitors } from './rules/engine.js';

export { MigraguardDb } from './db.js';
export type { MigrationRecord, MigrationStatus, InsertRecordOptions } from './db.js';
export { loadConfig, buildConfig } from './config.js';
export type { MigraguardConfig, RawConfig, Dialect } from './config.js';
export { commandApply } from './commands/apply.js';
export type { ApplyResult, ApplyOptions } from './commands/apply.js';
export { commandGroupStatus } from './commands/group-status.js';
export type { GroupStatusResult } from './commands/group-status.js';
export { commandAdvance } from './commands/advance.js';
export type { AdvanceResult, AdvanceOptions } from './commands/advance.js';
export { commandGate } from './commands/gate.js';
export type { GateResult, GateContract, GateOptions } from './commands/gate.js';
export { commandApplyPhase } from './commands/apply-phase.js';
export type { ApplyPhaseResult, ApplyPhaseOptions } from './commands/apply-phase.js';
export { commandBaseline } from './commands/baseline.js';
export type { BaselineResult, BaselineOptions } from './commands/baseline.js';
export type { GroupState, GroupStateName, PhaseRecord } from './group-state.js';
export { deriveGroupState, deriveAllGroupStates, isGroupOpen } from './group-state.js';
export type { Phase } from './naming.js';
export { ALL_PHASES, PHASE_ORDER } from './naming.js';
