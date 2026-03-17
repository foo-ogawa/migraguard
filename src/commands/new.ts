import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { generateFileName, generateGroupDirName } from '../naming.js';
import { scanMigrations } from '../scanner.js';

const TEMPLATE = `-- Migration: {description}
-- Created at: {timestamp}

`;

const EXPAND_TEMPLATE = `-- Phase: expand
-- Group: {group}
-- Created at: {timestamp}
--
-- New structure additions (idempotent).

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- TODO: Add new columns / tables / triggers using IF NOT EXISTS / OR REPLACE patterns

RESET lock_timeout;
RESET statement_timeout;
`;

const BACKFILL_TEMPLATE = `-- Phase: backfill
-- Group: {group}
-- Created at: {timestamp}
--
-- Existing data migration (batch-safe, idempotent).
-- Executed by external executor, not by migraguard apply.

SET statement_timeout = '300s';

-- TODO: UPDATE ... SET ... WHERE <not yet migrated> AND id BETWEEN :batch_start AND :batch_end

RESET statement_timeout;
`;

const SWITCH_TEMPLATE = `-- Phase: switch
-- Group: {group}
-- Created at: {timestamp}
--
-- Reference switchover (idempotent).

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- TODO: CREATE OR REPLACE VIEW / ADD CONSTRAINT ... NOT VALID patterns

RESET lock_timeout;
RESET statement_timeout;
`;

const CONTRACT_TEMPLATE = `-- Phase: contract
-- Group: {group}
-- Created at: {timestamp}
--
-- Old structure removal (idempotent).

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- TODO: DROP ... IF EXISTS / migraguard:allow directives for ban-drop-* rules

RESET lock_timeout;
RESET statement_timeout;
`;

export interface NewOptions {
  expandContract?: boolean;
}

export async function commandNew(
  config: MigraguardConfig,
  name: string,
  options?: NewOptions,
): Promise<void> {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Invalid migration name: "${name}". Use only alphanumeric characters and underscores.`);
  }

  const existingFiles = await scanMigrations(config);
  const existingParsed = existingFiles.map((f) => f.parsed);

  const now = new Date();
  const primaryDir = config.migrationsDirs[0];
  const migrationsDir = resolveFromConfig(config, primaryDir);

  if (!existsSync(migrationsDir)) {
    await mkdir(migrationsDir, { recursive: true });
  }

  if (options?.expandContract) {
    await createExpandContractGroup(config, name, now, existingParsed, primaryDir, migrationsDir);
  } else {
    await createSingleFile(config, name, now, existingParsed, primaryDir, migrationsDir);
  }
}

async function createSingleFile(
  config: MigraguardConfig,
  name: string,
  now: Date,
  existingParsed: import('../naming.js').ParsedFileName[],
  primaryDir: string,
  migrationsDir: string,
): Promise<void> {
  const fileName = generateFileName(name, config.naming, { now, existingParsed });
  const filePath = `${migrationsDir}/${fileName}`;

  if (existsSync(filePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }

  const content = TEMPLATE
    .replace('{description}', name)
    .replace('{timestamp}', now.toISOString());

  await writeFile(filePath, content, 'utf-8');
  console.log(chalk.green(`Created: ${primaryDir}/${fileName}`));
}

async function createExpandContractGroup(
  config: MigraguardConfig,
  name: string,
  now: Date,
  existingParsed: import('../naming.js').ParsedFileName[],
  primaryDir: string,
  migrationsDir: string,
): Promise<void> {
  const groupDir = generateGroupDirName(name, config.naming, { now, existingParsed });
  const groupPath = `${migrationsDir}/${groupDir}`;

  if (existsSync(groupPath)) {
    throw new Error(`Directory already exists: ${groupPath}`);
  }

  await mkdir(groupPath, { recursive: true });

  const ts = now.toISOString();
  const phaseFiles = [
    { name: '1_expand.sql', template: EXPAND_TEMPLATE },
    { name: '2_backfill.sql', template: BACKFILL_TEMPLATE },
    { name: '3_switch.sql', template: SWITCH_TEMPLATE },
    { name: '4_contract.sql', template: CONTRACT_TEMPLATE },
  ];

  for (const pf of phaseFiles) {
    const content = pf.template
      .replace('{group}', groupDir)
      .replace('{timestamp}', ts);
    await writeFile(`${groupPath}/${pf.name}`, content, 'utf-8');
  }

  console.log(chalk.green(`Created migration group: ${primaryDir}/${groupDir}/`));
  for (const pf of phaseFiles) {
    console.log(chalk.green(`  ${pf.name}`));
  }
}
