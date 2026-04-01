import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { scanMigrations } from '../scanner.js';
import { checksumFile } from '../checksum.js';
import { createDb } from '../db.js';
import type { MigrationRecord } from '../db.js';
import { dumpSchema } from '../dumper.js';
import { loadMetadata, saveMetadata } from '../metadata.js';
import type { MetadataJson, BaselineEntry } from '../metadata.js';
import {
  buildDependencyGraph,
  findLeafNodes,
} from '../deps.js';
import { deriveAllGroupStates, isGroupOpen } from '../group-state.js';

export interface BaselineOptions {
  keepSince?: string[];
}

export interface BaselineResult {
  success: boolean;
  squashedFiles: string[];
  remainingLeaves: string[];
  schemaFile: string;
  error?: string;
}

export async function commandBaseline(
  config: MigraguardConfig,
  options?: BaselineOptions,
): Promise<BaselineResult> {
  const db = createDb(config);

  try {
    await db.connect();
    await db.ensureTable();
    await db.acquireAdvisoryLock();

    const allRecords = await db.getAllRecords();
    const groupStates = deriveAllGroupStates(allRecords);

    const failedGroups = groupStates.filter((gs) => gs.state === 'backfill_failed');
    if (failedGroups.length > 0) {
      const msg = `Cannot baseline: ${failedGroups.length} group(s) in backfill_failed state`;
      console.error(chalk.red(msg));
      return { success: false, squashedFiles: [], remainingLeaves: [], schemaFile: '', error: msg };
    }

    const openGroups = new Set(
      groupStates.filter(isGroupOpen).map((gs) => gs.groupName),
    );

    const files = await scanMigrations(config);
    const graph = await buildDependencyGraph(config);
    const keepSince = options?.keepSince ?? [];

    let keepSet: Set<string>;
    if (keepSince.length === 0) {
      keepSet = new Set(findLeafNodes(graph));
    } else {
      keepSet = computeKeepSet(graph, keepSince, files.map((f) => f.fileName));
    }

    for (const file of files) {
      if (file.groupName && openGroups.has(file.groupName)) {
        keepSet.add(file.fileName);
      }
    }

    const squashTargets: string[] = [];
    const recordsByFile = new Map<string, MigrationRecord[]>();
    for (const r of allRecords) {
      const list = recordsByFile.get(r.fileName) ?? [];
      list.push(r);
      recordsByFile.set(r.fileName, list);
    }

    for (const file of files) {
      if (keepSet.has(file.fileName)) continue;

      const fileRecords = recordsByFile.get(file.fileName) ?? [];
      const latestRecord = fileRecords.reduce<MigrationRecord | undefined>(
        (latest, r) => (!latest || r.appliedAt > latest.appliedAt ? r : latest),
        undefined,
      );
      if (!latestRecord || latestRecord.status !== 'applied') {
        const msg = `Cannot baseline: "${file.fileName}" is not in applied state`;
        console.error(chalk.red(msg));
        return { success: false, squashedFiles: [], remainingLeaves: [], schemaFile: '', error: msg };
      }

      squashTargets.push(file.fileName);
    }

    if (squashTargets.length === 0) {
      console.log(chalk.yellow('No files to baseline.'));
      return { success: true, squashedFiles: [], remainingLeaves: [...keepSet], schemaFile: '' };
    }

    const schemaContent = await dumpSchema(config);
    const schemaPath = resolveFromConfig(config, config.schemaFile);

    const baselineIncludes: { file: string; checksum: string }[] = [];
    for (const fileName of squashTargets) {
      const file = files.find((f) => f.fileName === fileName);
      if (!file) continue;
      const checksum = await checksumFile(file.filePath);
      baselineIncludes.push({ file: fileName, checksum });
    }

    const now = new Date().toISOString();
    const historyComment = buildHistoryComment(schemaPath, baselineIncludes, now);
    const newSchemaContent = historyComment + schemaContent;
    await writeFile(schemaPath, newSchemaContent, 'utf-8');

    const metadata = await loadMetadata(config);
    const baselineEntry: BaselineEntry = {
      date: now,
      includes: baselineIncludes,
    };
    const updatedMetadata: MetadataJson = {
      ...metadata,
      baselines: [...(metadata.baselines ?? []), baselineEntry],
      migrations: metadata.migrations.filter((m) => !squashTargets.includes(m.file)),
    };
    await saveMetadata(config, updatedMetadata);

    for (const fileName of squashTargets) {
      const file = files.find((f) => f.fileName === fileName);
      if (!file) continue;

      if (file.groupName) {
        const groupDirPath = resolveFromConfig(config, `${file.sourceDir}/${file.groupName}`);
        if (existsSync(groupDirPath)) {
          await rm(groupDirPath, { recursive: true, force: true });
        }
      } else {
        if (existsSync(file.filePath)) {
          await rm(file.filePath);
        }
      }
    }

    await rewriteDependsOnReferences(config, keepSet, squashTargets);

    console.log(chalk.green(`Baseline completed: ${squashTargets.length} file(s) squashed into ${config.schemaFile}`));
    for (const f of squashTargets) {
      console.log(chalk.gray(`  squashed: ${f}`));
    }

    return {
      success: true,
      squashedFiles: squashTargets,
      remainingLeaves: [...keepSet],
      schemaFile: config.schemaFile,
    };
  } finally {
    await db.releaseAdvisoryLock().catch(() => {});
    await db.close();
  }
}

function computeKeepSet(
  graph: { files: string[]; edges: { from: string; to: string }[] },
  keepSince: string[],
  allFileNames: string[],
): Set<string> {
  const descendants = new Map<string, Set<string>>();
  for (const file of allFileNames) {
    descendants.set(file, new Set());
  }

  const childrenOf = new Map<string, string[]>();
  for (const f of allFileNames) childrenOf.set(f, []);
  for (const edge of graph.edges) {
    childrenOf.get(edge.to)?.push(edge.from);
  }

  for (const cutpoint of keepSince) {
    const resolved = allFileNames.find((f) => f === cutpoint || f.startsWith(cutpoint + '/'));
    if (!resolved) continue;

    const keep = new Set<string>([resolved]);
    const queue = [resolved];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const child of childrenOf.get(current) ?? []) {
        if (!keep.has(child)) {
          keep.add(child);
          queue.push(child);
        }
      }
    }
    for (const f of keep) {
      if (!descendants.has(f)) descendants.set(f, new Set());
      descendants.get(f)!.add(cutpoint);
    }
  }

  const keepSet = new Set<string>();
  for (const file of allFileNames) {
    for (const cutpoint of keepSince) {
      const resolved = allFileNames.find((f) => f === cutpoint || f.startsWith(cutpoint + '/'));
      if (!resolved) continue;

      if (file === resolved || (descendants.get(file)?.has(cutpoint))) {
        keepSet.add(file);
      }
    }
  }

  for (const cutpoint of keepSince) {
    const resolved = allFileNames.find((f) => f === cutpoint || f.startsWith(cutpoint + '/'));
    if (resolved) keepSet.add(resolved);
  }

  return keepSet;
}

async function buildHistoryComment(
  schemaPath: string,
  includes: { file: string; checksum: string }[],
  date: string,
): Promise<string> {
  let existingHistory = '';
  if (existsSync(schemaPath)) {
    const content = await readFile(schemaPath, 'utf-8');
    const startMarker = '-- migraguard:baseline-history\n';
    const endMarker = '-- migraguard:baseline-history-end\n';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx !== -1 && endIdx !== -1) {
      existingHistory = content.substring(startIdx + startMarker.length, endIdx);
    }
  }

  let comment = '-- migraguard:baseline-history\n--\n';
  comment += existingHistory;
  comment += `-- [baseline ${date}]\n`;
  for (const inc of includes) {
    comment += `-- ${inc.file} checksum=${inc.checksum}\n`;
  }
  comment += '--\n';
  comment += '-- migraguard:baseline-history-end\n\n';

  return comment;
}

async function rewriteDependsOnReferences(
  config: MigraguardConfig,
  keepSet: Set<string>,
  squashedFiles: string[],
): Promise<void> {
  const squashedSet = new Set(squashedFiles);
  const files = await scanMigrations(config);

  for (const file of files) {
    if (!keepSet.has(file.fileName)) continue;

    const content = await readFile(file.filePath, 'utf-8');
    let updated = content;
    let changed = false;

    for (const squashed of squashedSet) {
      const pattern = new RegExp(
        `(--\\s*migraguard:depends-on\\s+)${escapeRegExp(squashed)}(\\s|$)`,
        'g',
      );
      if (pattern.test(updated)) {
        updated = updated.replace(pattern, '$1baseline$2');
        changed = true;
      }
    }

    if (changed) {
      await writeFile(file.filePath, updated, 'utf-8');
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
