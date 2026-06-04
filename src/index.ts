export { pkg, VERSION } from './version.js';
export type { LintRule, LintViolation, RuleReport, RuleContext, NodeVisitors } from './rules/engine.js';

export { MigraguardDb, createDb, safeGetAllRecords } from './db.js';
export type { MigraguardDbAdapter, MigrationRecord, MigrationStatus, InsertRecordOptions } from './db.js';
export { executeSqlFile } from './executor.js';
export type { SqlExecResult } from './executor.js';
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
export {
  analyzeSql,
  analyzeFile,
  buildDependencyGraph,
  buildDependencyGraphFromFiles,
  detectCycles,
  topologicalSort,
  findLeafNodes,
  findTransitiveDependents,
  parseExplicitDepsFromSql,
  parseExplicitDepsFromConfig,
  parseExplicitDepTargetsFromSql,
} from './deps.js';
export type {
  ObjectRef,
  FileDeps,
  DependencyEdge,
  DependencyGraph,
  CycleError,
  ExplicitDep,
} from './deps.js';
export {
  createMigraguardInsightProvider,
  MigraguardInsightProvider,
  buildExternalInsight,
  buildExternalInsightFromGraph,
  buildAnchorMappings,
  INSIGHT_PROVIDER_NAME,
} from './external/insight-provider.js';
