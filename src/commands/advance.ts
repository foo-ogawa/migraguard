import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import type { Phase } from '../naming.js';
import type { MigrationStatus } from '../db.js';
import { createDb } from '../db.js';
import { deriveGroupState, canAdvanceToPhase } from '../group-state.js';

export interface AdvanceOptions {
  group: string;
  phase: Phase;
  status: 'running' | 'completed' | 'failed';
}

export interface AdvanceResult {
  success: boolean;
  previousState: string;
  newState: string;
  error?: string;
}

const STATUS_MAP: Record<AdvanceOptions['status'], MigrationStatus> = {
  running: 'running',
  completed: 'applied',
  failed: 'failed',
};

export async function commandAdvance(
  config: MigraguardConfig,
  options: AdvanceOptions,
): Promise<AdvanceResult> {
  const { group, phase, status } = options;
  const db = createDb(config);

  try {
    await db.connect();
    await db.ensureTable();
    await db.acquireAdvisoryLock();

    const allRecords = await db.getAllRecords();
    const currentState = deriveGroupState(allRecords, group);
    const previousState = currentState.state;

    if (!canAdvanceToPhase(currentState, phase)) {
      const msg = `Cannot advance "${group}" to ${phase}:${status} — prerequisite phases not complete (current state: ${previousState})`;
      console.error(chalk.red(msg));
      return { success: false, previousState, newState: previousState, error: msg };
    }

    const dbStatus = STATUS_MAP[status];
    const fileName = findPhaseFileName(group, phase, allRecords);

    await db.insertRecord(fileName, '', dbStatus, {
      migrationClass: 'expand_contract',
      phase,
      groupName: group,
    });

    const updatedRecords = await db.getAllRecords();
    const newState = deriveGroupState(updatedRecords, group).state;

    console.log(chalk.green(`Advanced "${group}" ${phase} → ${status} (state: ${previousState} → ${newState})`));
    return { success: true, previousState, newState };
  } finally {
    await db.releaseAdvisoryLock().catch(() => {});
    await db.close();
  }
}

function findPhaseFileName(group: string, phase: Phase, records: import('../db.js').MigrationRecord[]): string {
  const existing = records.find((r) => r.groupName === group && r.phase === phase);
  if (existing) return existing.fileName;

  const phaseNum = { expand: 1, backfill: 2, switch: 3, contract: 4 }[phase];
  return `${group}/${phaseNum}_${phase}.sql`;
}
