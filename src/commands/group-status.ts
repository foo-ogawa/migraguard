import { style } from '../output.js';
import type { MigraguardConfig } from '../config.js';
import { createDb, safeGetAllRecords } from '../db.js';
import { deriveAllGroupStates, deriveGroupState } from '../group-state.js';
import type { GroupState, GroupStateName } from '../group-state.js';

export interface GroupStatusResult {
  groups: GroupState[];
}

export async function commandGroupStatus(
  config: MigraguardConfig,
  groupName?: string,
): Promise<GroupStatusResult> {
  const db = createDb(config);

  try {
    await db.connect();

    const allRecords = await safeGetAllRecords(db);
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
      console.log(style.yellow('No migration groups found.'));
      return { groups: [] };
    }

    console.log(style.bold('Migration Groups:\n'));
    for (const gs of groups) {
      console.log(`  ${style.bold(gs.groupName)}`);
      console.log(`    state: ${colorState(gs.state)}`);
      for (const phase of ['expand', 'backfill', 'switch', 'contract'] as const) {
        const pr = gs.phases[phase];
        if (pr) {
          const statusStr = pr.status === 'applied'
            ? style.green(pr.status)
            : pr.status === 'failed'
              ? style.red(pr.status)
              : pr.status === 'running'
                ? style.yellow(pr.status)
                : style.gray(pr.status);
          console.log(`    ${phase.padEnd(10)} ${statusStr} (${pr.appliedAt.toISOString()})`);
        } else {
          console.log(`    ${phase.padEnd(10)} ${style.gray('not_applied')}`);
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
    case 'contract_completed': return style.green(state);
    case 'backfill_failed': return style.red(state);
    case 'backfill_running': return style.yellow(state);
    case 'not_applied': return style.gray(state);
    default: return style.cyan(state);
  }
}
