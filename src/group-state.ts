import type { MigrationRecord } from './db.js';
import type { Phase } from './naming.js';

export type GroupStateName =
  | 'not_applied'
  | 'expand_applied'
  | 'backfill_running'
  | 'backfill_failed'
  | 'backfill_completed'
  | 'switch_applied'
  | 'contract_ready'
  | 'contract_completed';

export interface PhaseRecord {
  fileName: string;
  status: 'applied' | 'failed' | 'skipped' | 'running';
  appliedAt: Date;
}

export interface GroupState {
  groupName: string;
  state: GroupStateName;
  phases: {
    expand: PhaseRecord | null;
    backfill: PhaseRecord | null;
    switch: PhaseRecord | null;
    contract: PhaseRecord | null;
  };
}

function latestRecordForPhase(
  records: MigrationRecord[],
  phase: Phase,
): MigrationRecord | undefined {
  const phaseRecords = records.filter((r) => r.phase === phase);
  if (phaseRecords.length === 0) return undefined;
  return phaseRecords.reduce((latest, r) =>
    r.appliedAt > latest.appliedAt ? r : latest,
  );
}

function toPhaseRecord(record: MigrationRecord): PhaseRecord {
  return {
    fileName: record.fileName,
    status: record.status,
    appliedAt: record.appliedAt,
  };
}

export function deriveGroupState(
  records: MigrationRecord[],
  groupName: string,
): GroupState {
  const groupRecords = records.filter((r) => r.groupName === groupName);

  const expandLatest = latestRecordForPhase(groupRecords, 'expand');
  const backfillLatest = latestRecordForPhase(groupRecords, 'backfill');
  const switchLatest = latestRecordForPhase(groupRecords, 'switch');
  const contractLatest = latestRecordForPhase(groupRecords, 'contract');

  const phases = {
    expand: expandLatest ? toPhaseRecord(expandLatest) : null,
    backfill: backfillLatest ? toPhaseRecord(backfillLatest) : null,
    switch: switchLatest ? toPhaseRecord(switchLatest) : null,
    contract: contractLatest ? toPhaseRecord(contractLatest) : null,
  };

  const state = computeState(expandLatest, backfillLatest, switchLatest, contractLatest);

  return { groupName, state, phases };
}

function computeState(
  expand: MigrationRecord | undefined,
  backfill: MigrationRecord | undefined,
  switchRec: MigrationRecord | undefined,
  contract: MigrationRecord | undefined,
): GroupStateName {
  if (!expand || expand.status !== 'applied') {
    return 'not_applied';
  }

  if (contract && contract.status === 'applied') {
    return 'contract_completed';
  }

  if (switchRec && switchRec.status === 'applied') {
    return 'contract_ready';
  }

  if (backfill) {
    if (backfill.status === 'running') return 'backfill_running';
    if (backfill.status === 'failed') return 'backfill_failed';
    if (backfill.status === 'applied') {
      return 'backfill_completed';
    }
  }

  return 'expand_applied';
}

export function deriveAllGroupStates(records: MigrationRecord[]): GroupState[] {
  const groupNames = new Set<string>();
  for (const r of records) {
    if (r.groupName) groupNames.add(r.groupName);
  }

  const states: GroupState[] = [];
  for (const groupName of groupNames) {
    states.push(deriveGroupState(records, groupName));
  }
  return states;
}

export function isGroupOpen(state: GroupState): boolean {
  return state.state !== 'contract_completed' && state.state !== 'not_applied';
}

export function isPhaseComplete(state: GroupState, phase: Phase): boolean {
  switch (phase) {
    case 'expand':
      return state.phases.expand?.status === 'applied';
    case 'backfill':
      return state.phases.backfill?.status === 'applied';
    case 'switch':
      return state.phases.switch?.status === 'applied';
    case 'contract':
      return state.phases.contract?.status === 'applied';
  }
}

export function canAdvanceToPhase(state: GroupState, phase: Phase): boolean {
  switch (phase) {
    case 'expand':
      return true;
    case 'backfill':
      return state.phases.expand?.status === 'applied';
    case 'switch': {
      if (!state.phases.expand || state.phases.expand.status !== 'applied') return false;
      if (state.phases.backfill && state.phases.backfill.status !== 'applied') return false;
      return true;
    }
    case 'contract': {
      if (!state.phases.expand || state.phases.expand.status !== 'applied') return false;
      if (state.phases.backfill && state.phases.backfill.status !== 'applied') return false;
      if (state.phases.switch && state.phases.switch.status !== 'applied') return false;
      return true;
    }
  }
}
