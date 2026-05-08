import { describe, it, expect } from 'vitest';
import {
  deriveGroupState,
  deriveAllGroupStates,
  isGroupOpen,
  isPhaseComplete,
  canAdvanceToPhase,
} from '../src/group-state.js';
import type { MigrationRecord } from '../src/db.js';

function makeRecord(
  overrides: Partial<MigrationRecord> & { fileName: string },
): MigrationRecord {
  return {
    checksum: 'abc123',
    status: 'applied',
    appliedAt: new Date('2026-03-15T10:00:00Z'),
    resolvedAt: null,
    migrationClass: 'expand_contract',
    phase: null,
    groupName: null,
    tag: null,
    ...overrides,
  };
}

const GROUP = '20260315_100000__rename_user_status';

describe('group-state', () => {
  describe('deriveGroupState', () => {
    it('returns not_applied when no records exist', () => {
      const state = deriveGroupState([], GROUP);
      expect(state.state).toBe('not_applied');
      expect(state.phases.expand).toBeNull();
    });

    it('returns expand_applied when only expand is applied', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(state.state).toBe('expand_applied');
      expect(state.phases.expand?.status).toBe('applied');
    });

    it('returns backfill_running when backfill is running', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          status: 'running',
          appliedAt: new Date('2026-03-16T08:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(state.state).toBe('backfill_running');
    });

    it('returns backfill_failed when backfill has failed', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          status: 'failed',
          appliedAt: new Date('2026-03-16T08:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(state.state).toBe('backfill_failed');
    });

    it('returns backfill_completed when backfill is applied', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          appliedAt: new Date('2026-03-16T08:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(state.state).toBe('backfill_completed');
    });

    it('returns contract_ready when switch is applied', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          appliedAt: new Date('2026-03-16T08:00:00Z'),
        }),
        makeRecord({
          fileName: `${GROUP}/3_switch.sql`,
          phase: 'switch',
          groupName: GROUP,
          appliedAt: new Date('2026-03-17T08:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(state.state).toBe('contract_ready');
    });

    it('returns contract_completed when contract is applied', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          appliedAt: new Date('2026-03-16T08:00:00Z'),
        }),
        makeRecord({
          fileName: `${GROUP}/3_switch.sql`,
          phase: 'switch',
          groupName: GROUP,
          appliedAt: new Date('2026-03-17T08:00:00Z'),
        }),
        makeRecord({
          fileName: `${GROUP}/4_contract.sql`,
          phase: 'contract',
          groupName: GROUP,
          appliedAt: new Date('2026-03-18T08:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(state.state).toBe('contract_completed');
    });

    it('uses latest record when multiple records exist for a phase', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          status: 'running',
          appliedAt: new Date('2026-03-16T08:00:00Z'),
        }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          status: 'applied',
          appliedAt: new Date('2026-03-16T12:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(state.state).toBe('backfill_completed');
    });
  });

  describe('deriveAllGroupStates', () => {
    it('returns states for all groups', () => {
      const group2 = '20260401_090000__split_orders';
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({ fileName: `${group2}/1_expand.sql`, phase: 'expand', groupName: group2 }),
      ];
      const states = deriveAllGroupStates(records);
      expect(states).toHaveLength(2);
    });

    it('returns empty array when no group records', () => {
      const records = [
        makeRecord({ fileName: 'some_safe.sql', migrationClass: 'safe' }),
      ];
      const states = deriveAllGroupStates(records);
      expect(states).toHaveLength(0);
    });
  });

  describe('isGroupOpen', () => {
    it('returns false for not_applied', () => {
      const state = deriveGroupState([], GROUP);
      expect(isGroupOpen(state)).toBe(false);
    });

    it('returns true for expand_applied', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
      ];
      expect(isGroupOpen(deriveGroupState(records, GROUP))).toBe(true);
    });

    it('returns false for contract_completed', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({ fileName: `${GROUP}/4_contract.sql`, phase: 'contract', groupName: GROUP, appliedAt: new Date('2026-03-18T08:00:00Z') }),
      ];
      expect(isGroupOpen(deriveGroupState(records, GROUP))).toBe(false);
    });
  });

  describe('isPhaseComplete', () => {
    it('checks expand completion', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
      ];
      const state = deriveGroupState(records, GROUP);
      expect(isPhaseComplete(state, 'expand')).toBe(true);
      expect(isPhaseComplete(state, 'backfill')).toBe(false);
    });
  });

  describe('canAdvanceToPhase', () => {
    it('can always advance to expand', () => {
      const state = deriveGroupState([], GROUP);
      expect(canAdvanceToPhase(state, 'expand')).toBe(true);
    });

    it('requires expand applied for backfill', () => {
      const state = deriveGroupState([], GROUP);
      expect(canAdvanceToPhase(state, 'backfill')).toBe(false);

      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
      ];
      expect(canAdvanceToPhase(deriveGroupState(records, GROUP), 'backfill')).toBe(true);
    });

    it('requires expand and backfill for switch', () => {
      const records = [
        makeRecord({ fileName: `${GROUP}/1_expand.sql`, phase: 'expand', groupName: GROUP }),
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          status: 'running',
          appliedAt: new Date('2026-03-16T08:00:00Z'),
        }),
      ];
      expect(canAdvanceToPhase(deriveGroupState(records, GROUP), 'switch')).toBe(false);

      const records2 = [
        ...records,
        makeRecord({
          fileName: `${GROUP}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP,
          appliedAt: new Date('2026-03-16T12:00:00Z'),
        }),
      ];
      expect(canAdvanceToPhase(deriveGroupState(records2, GROUP), 'switch')).toBe(true);
    });
  });
});
