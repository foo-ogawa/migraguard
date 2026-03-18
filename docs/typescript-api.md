# TypeScript API

migraguard exposes all core commands as typed async functions, allowing you to integrate migration control directly into your Node.js / TypeScript applications, deployment scripts, and CI pipelines without shelling out to the CLI.

## Installation

```bash
npm install migraguard
```

## Quick Start

```typescript
import { loadConfig, commandApply } from 'migraguard';

const config = await loadConfig('/path/to/project');
const result = await commandApply(config);

if (result.errors.length > 0) {
  process.exit(1);
}
```

## Configuration

### `loadConfig(startDir?): Promise<MigraguardConfig>`

Locates `migraguard.config.json` by walking up from `startDir` (defaults to `process.cwd()`), merges it with defaults, and applies `PG*` environment variable overrides.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startDir` | `string` | `process.cwd()` | Directory to start searching for config |

### `buildConfig(raw, configDir): MigraguardConfig`

Builds a config object from a partial `RawConfig` without reading from disk. Useful for testing or when config values are supplied programmatically.

| Parameter | Type | Description |
|-----------|------|-------------|
| `raw` | `RawConfig` | Partial configuration |
| `configDir` | `string` | Base directory for resolving relative paths |

### `MigraguardConfig`

| Field | Type | Description |
|-------|------|-------------|
| `configDir` | `string` | Absolute path to the project root |
| `model` | `'dag' \| undefined` | Dependency model (`undefined` = linear) |
| `migrationsDirs` | `string[]` | Directories containing migration files |
| `schemaFile` | `string` | Path to `schema.sql` |
| `metadataFile` | `string` | Path to `metadata.json` |
| `naming` | `NamingConfig` | Naming pattern config |
| `connection` | `ConnectionConfig` | PostgreSQL connection parameters |
| `dump` | `DumpConfig` | Schema dump options |
| `lint` | `LintConfig` | Lint rule configuration |

## Database Access

### `MigraguardDb`

Low-level database client for the `schema_migrations` table. Most users should prefer the command functions, but `MigraguardDb` is available for custom queries and tooling.

```typescript
import { MigraguardDb } from 'migraguard';

const db = new MigraguardDb(config);
await db.connect();
await db.ensureTable();

const records = await db.getAllRecords();
// ...

await db.close();
```

#### Methods

| Method | Return | Description |
|--------|--------|-------------|
| `connect()` | `Promise<void>` | Opens a PostgreSQL connection |
| `close()` | `Promise<void>` | Closes the connection |
| `ensureTable()` | `Promise<void>` | Creates or upgrades `schema_migrations` |
| `acquireAdvisoryLock()` | `Promise<void>` | Acquires a session-level advisory lock |
| `releaseAdvisoryLock()` | `Promise<void>` | Releases the advisory lock |
| `getAllRecords()` | `Promise<MigrationRecord[]>` | Returns all records ordered by `applied_at` |
| `getRecordsForFile(fileName)` | `Promise<MigrationRecord[]>` | Returns records for a specific file |
| `insertRecord(fileName, checksum, status, options?)` | `Promise<void>` | Inserts a new record |
| `getClient()` | `pg.Client` | Returns the underlying `pg` Client |

### `MigrationRecord`

| Field | Type | Description |
|-------|------|-------------|
| `fileName` | `string` | Migration file name |
| `checksum` | `string` | SHA-256 checksum |
| `status` | `MigrationStatus` | `'applied' \| 'failed' \| 'skipped' \| 'running'` |
| `appliedAt` | `Date` | Timestamp of record insertion |
| `resolvedAt` | `Date \| null` | Timestamp of resolution (for skipped) |
| `migrationClass` | `MigrationClass` | `'safe' \| 'expand_contract'` |
| `phase` | `Phase \| null` | Phase name for expand/contract migrations |
| `groupName` | `string \| null` | Group directory name for expand/contract |

## Commands

All command functions follow the same pattern: accept a `MigraguardConfig` and an options object, return a typed result, and manage their own database connections internally.

### `commandApply(config, options?): Promise<ApplyResult>`

Applies pending migrations. Class B (expand/contract) backfill phases are always skipped; switch and contract phases are applied only when prerequisites are met.

#### `ApplyOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `withDriftCheck` | `boolean` | `false` | Compare DB schema against `schema.sql` before applying |
| `fromBaseline` | `boolean` | `false` | Apply `schema.sql` first, then record baselined files |

#### `ApplyResult`

| Field | Type | Description |
|-------|------|-------------|
| `applied` | `string[]` | Files that were applied |
| `skipped` | `string[]` | Files that were skipped (already applied, or phase not ready) |
| `failed` | `string \| null` | First file that failed |
| `blocked` | `string[]` | Files blocked by dependency failures or open groups |
| `errors` | `string[]` | Error messages |

### `commandApplyPhase(config, options): Promise<ApplyPhaseResult>`

Applies a single phase of an expand/contract migration group. Validates that prerequisite phases are complete before execution.

#### `ApplyPhaseOptions`

| Field | Type | Description |
|-------|------|-------------|
| `group` | `string` | Group directory name (e.g. `20260315_100000__rename_status`) |
| `phase` | `Phase` | `'expand' \| 'backfill' \| 'switch' \| 'contract'` |

#### `ApplyPhaseResult`

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the phase was applied |
| `group` | `string` | Group name |
| `phase` | `string` | Phase name |
| `error` | `string \| undefined` | Error message on failure |

### `commandAdvance(config, options): Promise<AdvanceResult>`

Records a phase state transition without executing SQL. Designed for external executors (e.g. backfill workers) to report progress.

#### `AdvanceOptions`

| Field | Type | Description |
|-------|------|-------------|
| `group` | `string` | Group directory name |
| `phase` | `Phase` | Target phase |
| `status` | `'running' \| 'completed' \| 'failed'` | New status to record |

#### `AdvanceResult`

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the advance succeeded |
| `previousState` | `string` | Group state before advance |
| `newState` | `string` | Group state after advance |
| `error` | `string \| undefined` | Error message on failure |

### `commandGroupStatus(config, groupName?): Promise<GroupStatusResult>`

Returns the current state of one or all expand/contract migration groups.

| Parameter | Type | Description |
|-----------|------|-------------|
| `groupName` | `string \| undefined` | Specific group to query, or all groups |

#### `GroupStatusResult`

| Field | Type | Description |
|-------|------|-------------|
| `groups` | `GroupState[]` | Array of group state objects |

### `commandGate(config, options): Promise<GateResult>`

Evaluates deployment gate conditions against the current migration state. Returns pass/fail with reasons.

#### `GateOptions`

| Field | Type | Description |
|-------|------|-------------|
| `required` | `string[]` | Conditions that must be true (e.g. `group:rename_status.backfill_completed`) |
| `forbidden` | `string[]` | Conditions that must be false |
| `contractFile` | `string` | Path to a JSON contract file (alternative to inline conditions) |

The contract file format:

```json
{
  "requiredSchemaState": ["group:rename_status.backfill_completed"],
  "forbiddenSchemaState": ["group:rename_status.backfill_running"]
}
```

Condition syntax: `group:<name>.<state>` where `<name>` is the full group directory name or the description suffix (after `__`), and `<state>` is a `GroupStateName`.

#### `GateResult`

| Field | Type | Description |
|-------|------|-------------|
| `pass` | `boolean` | Whether all conditions passed |
| `reasons` | `string[]` | Failure reasons |
| `groupStates` | `GroupState[]` | Current state of all groups |

### `commandBaseline(config, options?): Promise<BaselineResult>`

Squashes applied migrations into `schema.sql`, removing old files and updating `metadata.json`. Open expand/contract groups are never squashed.

#### `BaselineOptions`

| Field | Type | Description |
|-------|------|-------------|
| `keepSince` | `string[]` | File names to keep (along with their descendants). Defaults to leaf nodes. |

#### `BaselineResult`

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the baseline completed |
| `squashedFiles` | `string[]` | Files that were squashed |
| `remainingLeaves` | `string[]` | Files that remain after squash |
| `schemaFile` | `string` | Path to the updated schema file |
| `error` | `string \| undefined` | Error message on failure |

## Group State

### Types

```typescript
type Phase = 'expand' | 'backfill' | 'switch' | 'contract';

type GroupStateName =
  | 'not_applied'
  | 'expand_applied'
  | 'backfill_running'
  | 'backfill_failed'
  | 'backfill_completed'
  | 'switch_applied'
  | 'contract_ready'
  | 'contract_completed';

interface GroupState {
  groupName: string;
  state: GroupStateName;
  phases: {
    expand: PhaseRecord | null;
    backfill: PhaseRecord | null;
    switch: PhaseRecord | null;
    contract: PhaseRecord | null;
  };
}

interface PhaseRecord {
  fileName: string;
  status: 'applied' | 'failed' | 'skipped' | 'running';
  appliedAt: Date;
}
```

### Utility Functions

| Function | Return | Description |
|----------|--------|-------------|
| `deriveGroupState(records, groupName)` | `GroupState` | Derives the state of a single group from migration records |
| `deriveAllGroupStates(records)` | `GroupState[]` | Derives states for all groups found in the records |
| `isGroupOpen(state)` | `boolean` | `true` if the group is in progress (neither `not_applied` nor `contract_completed`) |

### Constants

| Constant | Type | Value |
|----------|------|-------|
| `ALL_PHASES` | `Phase[]` | `['expand', 'backfill', 'switch', 'contract']` |
| `PHASE_ORDER` | `Record<Phase, number>` | `{ expand: 1, backfill: 2, switch: 3, contract: 4 }` |

## End-to-End Example: Expand/Contract Workflow

A typical expand/contract lifecycle driven entirely from TypeScript:

```typescript
import {
  loadConfig,
  commandApply,
  commandAdvance,
  commandApplyPhase,
  commandGate,
  commandGroupStatus,
} from 'migraguard';

const config = await loadConfig();
const GROUP = '20260315_100000__rename_username_to_handle';

// 1. Apply all pending migrations (expand phases auto-applied, backfill skipped)
await commandApply(config);

// 2. External executor starts backfill
await commandAdvance(config, {
  group: GROUP,
  phase: 'backfill',
  status: 'running',
});

// 3. ... run backfill batches ...

// 4. External executor marks backfill complete
await commandAdvance(config, {
  group: GROUP,
  phase: 'backfill',
  status: 'completed',
});

// 5. Deployment gate check before deploying the new app version
const gate = await commandGate(config, {
  required: [`group:rename_username_to_handle.backfill_completed`],
});
if (!gate.pass) {
  console.error('Gate failed:', gate.reasons);
  process.exit(1);
}

// 6. Apply switch phase
await commandApplyPhase(config, { group: GROUP, phase: 'switch' });

// 7. Apply contract phase (after app deployment confirms no rollback needed)
await commandApplyPhase(config, { group: GROUP, phase: 'contract' });

// 8. Verify final state
const status = await commandGroupStatus(config, GROUP);
console.log(status.groups[0].state); // 'contract_completed'
```
