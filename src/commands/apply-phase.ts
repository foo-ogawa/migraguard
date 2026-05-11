import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import type { Phase } from '../naming.js';
import { PHASE_ORDER } from '../naming.js';
import { scanMigrations } from '../scanner.js';
import { checksumFile } from '../checksum.js';
import { createDb } from '../db.js';
import { executeSqlFile } from '../executor.js';
import { deriveGroupState, canAdvanceToPhase } from '../group-state.js';

export interface ApplyPhaseOptions {
  group: string;
  phase: Phase;
  tag?: string;
  dryRun?: boolean;
}

export interface ApplyPhaseResult {
  success: boolean;
  group: string;
  phase: string;
  error?: string;
}

export async function commandApplyPhase(
  config: MigraguardConfig,
  options: ApplyPhaseOptions,
): Promise<ApplyPhaseResult> {
  const { group, phase } = options;
  const db = createDb(config);

  try {
    await db.connect();
    await db.ensureTable();
    await db.acquireAdvisoryLock();

    const allRecords = await db.getAllRecords();
    const currentState = deriveGroupState(allRecords, group);

    if (!canAdvanceToPhase(currentState, phase)) {
      const msg = `Cannot apply phase "${phase}" for "${group}" — prerequisite phases not complete (current state: ${currentState.state})`;
      console.error(chalk.red(msg));
      return { success: false, group, phase, error: msg };
    }

    const files = await scanMigrations(config);
    const phaseNum = PHASE_ORDER[phase];
    const expectedFileName = `${group}/${phaseNum}_${phase}.sql`;
    const file = files.find((f) => f.fileName === expectedFileName);

    if (!file) {
      const msg = `Phase file not found: ${expectedFileName}`;
      console.error(chalk.red(msg));
      return { success: false, group, phase, error: msg };
    }

    const checksum = await checksumFile(file.filePath);

    if (options.dryRun) {
      console.log(chalk.cyan(`[dry-run] Would apply phase "${phase}" for "${group}"`));
      console.log(chalk.cyan(`  File: ${expectedFileName}`));
      console.log(chalk.cyan(`  Checksum: ${checksum}`));
      return { success: true, group, phase };
    }

    const psqlResult = await executeSqlFile(config, file.filePath);

    if (psqlResult.success) {
      await db.insertRecord(file.fileName, checksum, 'applied', {
        migrationClass: 'expand_contract',
        phase,
        groupName: group,
        tag: options.tag,
      });
      console.log(chalk.green(`Applied phase "${phase}" for "${group}"`));
      return { success: true, group, phase };
    } else {
      await db.insertRecord(file.fileName, checksum, 'failed', {
        migrationClass: 'expand_contract',
        phase,
        groupName: group,
        tag: options.tag,
      });
      const msg = `Failed to apply phase "${phase}" for "${group}": ${psqlResult.stderr}`;
      console.error(chalk.red(msg));
      return { success: false, group, phase, error: msg };
    }
  } finally {
    await db.releaseAdvisoryLock().catch(() => {});
    await db.close();
  }
}
