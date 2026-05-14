import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { createDb, safeGetAllRecords } from '../db.js';
import { deriveAllGroupStates } from '../group-state.js';
import type { GroupState, GroupStateName } from '../group-state.js';

export interface GateContract {
  required: string[];
  forbidden: string[];
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
  groupStates: GroupState[];
}

export interface GateOptions {
  required?: string[];
  forbidden?: string[];
  contractFile?: string;
}

export async function commandGate(
  config: MigraguardConfig,
  options: GateOptions,
): Promise<GateResult> {
  let contract: GateContract;

  if (options.contractFile) {
    const content = await readFile(options.contractFile, 'utf-8');
    const parsed = JSON.parse(content) as { requiredSchemaState?: string[]; forbiddenSchemaState?: string[] };
    contract = {
      required: parsed.requiredSchemaState ?? [],
      forbidden: parsed.forbiddenSchemaState ?? [],
    };
  } else {
    contract = {
      required: options.required ?? [],
      forbidden: options.forbidden ?? [],
    };
  }

  const db = createDb(config);

  try {
    await db.connect();

    const allRecords = await safeGetAllRecords(db);
    const groupStates = deriveAllGroupStates(allRecords);
    const reasons: string[] = [];

    for (const req of contract.required) {
      if (!evaluateCondition(groupStates, req)) {
        reasons.push(`Required condition not met: ${req}`);
      }
    }

    for (const forbid of contract.forbidden) {
      if (evaluateCondition(groupStates, forbid)) {
        reasons.push(`Forbidden condition present: ${forbid}`);
      }
    }

    const pass = reasons.length === 0;

    if (pass) {
      console.log(chalk.green('Gate: PASS'));
    } else {
      console.error(chalk.red('Gate: FAIL'));
      for (const reason of reasons) {
        console.error(chalk.red(`  - ${reason}`));
      }
    }

    return { pass, reasons, groupStates };
  } finally {
    await db.close();
  }
}

function evaluateCondition(groupStates: GroupState[], condition: string): boolean {
  const match = condition.match(/^group:([^.]+)\.(.+)$/);
  if (!match) return false;

  const groupNamePart = match[1];
  const requiredState = match[2] as GroupStateName;

  const gs = groupStates.find((s) => {
    const shortName = extractShortName(s.groupName);
    return s.groupName === groupNamePart || shortName === groupNamePart;
  });

  if (!gs) return false;

  return matchesState(gs.state, requiredState);
}

function extractShortName(groupName: string): string {
  const match = groupName.match(/__(.+)$/);
  return match ? match[1] : groupName;
}

function matchesState(currentState: GroupStateName, targetState: GroupStateName): boolean {
  if (currentState === targetState) return true;

  const stateOrder: GroupStateName[] = [
    'not_applied',
    'expand_applied',
    'backfill_running',
    'backfill_completed',
    'switch_applied',
    'contract_ready',
    'contract_completed',
  ];

  const currentIdx = stateOrder.indexOf(currentState);
  const targetIdx = stateOrder.indexOf(targetState);

  if (currentIdx === -1 || targetIdx === -1) return false;
  return currentIdx >= targetIdx;
}
