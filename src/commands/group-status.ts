import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { MigraguardDb } from '../db.js';
import { deriveAllGroupStates, deriveGroupState } from '../group-state.js';
import type { GroupState, GroupStateName } from '../group-state.js';

export interface GroupStatusResult {
  groups: GroupState[];
}

export async function commandGroupStatus(
  config: MigraguardConfig,
  groupName?: string,
): Promise<GroupStatusResult> {
  const db = new MigraguardDb(config);

  try {
    await db.connect();
    await db.ensureTable();

    const allRecords = await db.getAllRecords();
    let groups: GroupState[];

    if (groupName) {
      const state = deriveGroupState(allRecords, groupName);
      if (state.state === 'not_applied' && !allRecords.some((r) => r.groupName === groupName)) {
        throw new Error(`Migration group not found: "${groupName}"`);
      }
      groups = [state];
    } else {
      groups = deriveAllGroupStates(allRecords);
    }

    if (groups.length === 0) {
      console.log(chalk.yellow('No migration groups found.'));
      return { groups: [] };
    }

    console.log(chalk.bold('Migration Groups:\n'));
    for (const gs of groups) {
      console.log(`  ${chalk.bold(gs.groupName)}`);
      console.log(`    state: ${colorState(gs.state)}`);
      for (const phase of ['expand', 'backfill', 'switch', 'contract'] as const) {
        const pr = gs.phases[phase];
        if (pr) {
          const statusStr = pr.status === 'applied'
            ? chalk.green(pr.status)
            : pr.status === 'failed'
              ? chalk.red(pr.status)
              : pr.status === 'running'
                ? chalk.yellow(pr.status)
                : chalk.gray(pr.status);
          console.log(`    ${phase.padEnd(10)} ${statusStr} (${pr.appliedAt.toISOString()})`);
        } else {
          console.log(`    ${phase.padEnd(10)} ${chalk.gray('not_applied')}`);
        }
      }
      console.log();
    }

    return { groups };
  } finally {
    await db.close();
  }
}

function colorState(state: GroupStateName): string {
  switch (state) {
    case 'contract_completed': return chalk.green(state);
    case 'backfill_failed': return chalk.red(state);
    case 'backfill_running': return chalk.yellow(state);
    case 'not_applied': return chalk.gray(state);
    default: return chalk.cyan(state);
  }
}
