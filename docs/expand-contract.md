# Expand/Contract Pattern

Long-running schema changes — column renames, type migrations, table splits — cannot be executed as a single DDL statement without downtime. The expand/contract pattern breaks these changes into phases that can be applied incrementally while the application continues to serve traffic.

migraguard provides first-class support for this pattern through **Migration Groups** (Class B migrations), a phase-aware state machine, executor utility commands, and a deployment gate.

## When to Use Expand/Contract

Use this pattern when a schema change:

- requires **data backfill** across millions of rows,
- involves **renaming or moving columns/tables** that are actively read by running application code,
- needs a **staged cutover** where old and new structures coexist,
- requires **coordination with application deployments** (the app must be updated to read the new structure before the old one is removed).

For simple, non-destructive DDL (CREATE TABLE, ADD NULLABLE COLUMN, ADD INDEX), use standard Class A migrations.

## Migration Classes

| Class | Scope | Example |
|-------|-------|---------|
| **Class A** (safe/short) | Single `.sql` file, completes in seconds | `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX CONCURRENTLY` |
| **Class B** (expand/contract) | Directory with phased `.sql` files, may span days | Column rename, table split, type migration |

## File Structure

A Class B migration is a **directory** inside the migrations folder. The directory name follows the same timestamp/description convention as Class A files, but without the `.sql` extension.

```
db/migrations/
  20260301_120000__create_users.sql                       ← Class A
  20260315_100000__rename_username_to_handle/              ← Class B (directory)
    1_expand.sql
    2_backfill.sql
    3_switch.sql
    4_contract.sql
  20260320_090000__add_orders_table.sql                   ← Class A
```

### Phase Files

| Phase | File | Purpose | Executed by |
|-------|------|---------|-------------|
| **expand** | `1_expand.sql` | Add new structure (columns, tables, triggers) | `migraguard apply` or `apply-phase` |
| **backfill** | `2_backfill.sql` | Migrate existing data in batches | External executor via `apply-phase` / `advance` |
| **switch** | `3_switch.sql` | Switch references (views, constraints) | `migraguard apply` or `apply-phase` |
| **contract** | `4_contract.sql` | Remove old structure | `migraguard apply` or `apply-phase` |

- `1_expand.sql` is **required**. All other phases are optional.
- Each phase file must be **idempotent** — safe to re-execute after partial failure.
- `migraguard apply` automatically applies `expand`, skips `backfill` (executor responsibility), and applies `switch`/`contract` only when prerequisites are met.

### Creating a Migration Group

```bash
migraguard new --expand-contract rename_username_to_handle
# → db/migrations/20260315_100000__rename_username_to_handle/
#     1_expand.sql
#     2_backfill.sql
#     3_switch.sql
#     4_contract.sql
```

Generated templates include timeout discipline (`SET lock_timeout` / `SET statement_timeout` / `RESET`) and idempotency hints.

## State Machine

The state of a Migration Group is derived from `schema_migrations` records — no additional table is needed. The INSERT-only principle is preserved.

```
not_applied
     │
     ▼
expand_applied ──────────────────────┐
     │                               │ (backfill not needed)
     ▼                               │
backfill_running                     │
     │         │                     │
     ▼         ▼                     │
backfill_completed  backfill_failed  │
     │                  │            │
     │    (fix & retry) │            │
     │         ▼        │            │
     │    backfill_running           │
     │                               │
     ▼                               │
contract_ready ◄─────────────────────┘
     │
     ▼
contract_completed (terminal)
```

A group is **open** (non-terminal) from `expand_applied` through `contract_ready`. Open groups can block dependent migrations and deployments.

### Extended schema_migrations Columns

```sql
ALTER TABLE schema_migrations
  ADD COLUMN IF NOT EXISTS migration_class VARCHAR(16) DEFAULT 'safe',
  ADD COLUMN IF NOT EXISTS phase VARCHAR(16),
  ADD COLUMN IF NOT EXISTS group_name VARCHAR(256);
```

These columns are added automatically on first use. Existing Class A records remain unchanged (`migration_class = 'safe'`, `phase = NULL`).

## Commands

### `migraguard group-status [group]`

Display the current state of all Migration Groups, or a specific group.

```bash
migraguard group-status

# Output:
# Migration Groups:
#   20260315_100000__rename_username_to_handle
#     state: backfill_running
#     expand:    applied (2026-03-15T10:30:00Z)
#     backfill:  running (2026-03-16T08:00:00Z)
#     switch:    not_applied
#     contract:  not_applied
```

### `migraguard advance <group> <phase> <status>`

Record a phase state transition. Used by external executors to report backfill progress.

```bash
migraguard advance 20260315_100000__rename_username_to_handle backfill running
migraguard advance 20260315_100000__rename_username_to_handle backfill completed
migraguard advance 20260315_100000__rename_username_to_handle backfill failed
```

Validates prerequisites before allowing the transition (e.g., `expand` must be `applied` before `backfill` can start).

### `migraguard apply-phase <group> <phase>`

Execute a specific phase file via the native CLI and record the result. Used when fine-grained control is needed.

```bash
migraguard apply-phase 20260315_100000__rename_username_to_handle expand
migraguard apply-phase 20260315_100000__rename_username_to_handle switch
migraguard apply-phase 20260315_100000__rename_username_to_handle contract
```

Acquires an advisory lock and validates prerequisite phases before execution.

### `migraguard gate`

Evaluate deployment gate conditions against current Migration Group states. Returns exit code 0 (pass) or 1 (fail).

```bash
migraguard gate \
  --require "group:rename_username_to_handle.expand_applied" \
  --forbid  "group:rename_username_to_handle.contract_completed"
```

Also accepts a JSON contract file:

```bash
migraguard gate --contract-file schema-requirements.json
```

```json
{
  "requiredSchemaState": [
    "group:rename_username_to_handle.expand_applied"
  ],
  "forbiddenSchemaState": [
    "group:rename_username_to_handle.contract_completed"
  ]
}
```

### `migraguard baseline`

Squash applied migrations into `schema.sql`. See [Baseline Squash](#baseline-squash) below.

## Phase-Level Dependencies

When a Class A migration (or another group) depends on a specific phase of a Migration Group, declare the dependency with a phase suffix:

```sql
-- Depends on expand completion (new column exists)
-- migraguard:depends-on 20260315_100000__rename_username_to_handle:expand

-- Depends on backfill completion (data is migrated)
-- migraguard:depends-on 20260315_100000__rename_username_to_handle:backfill

-- Depends on contract completion (old structure removed)
-- migraguard:depends-on 20260315_100000__rename_username_to_handle:contract
```

If the phase suffix is omitted, the default is `:expand` — the most common case where the new structure must exist but data migration is not yet required.

## Phase-Specific Lint Rules

migraguard enforces phase-appropriate patterns via lint rules that activate only for the relevant phase:

| Rule | Phase | Enforces |
|------|-------|----------|
| `expand-requires-idempotent-pattern` | expand | `IF NOT EXISTS` / `OR REPLACE` for all DDL |
| `backfill-requires-where-clause` | backfill | `WHERE` clause on UPDATE/DELETE |
| `backfill-ban-ddl` | backfill | No DDL statements (CREATE/ALTER/DROP) in backfill |
| `contract-requires-allow-directive` | contract | Explicit `migraguard:allow` for DROP operations |

These rules do not apply to Class A migrations or to phases other than their target.

## Open Group Blocking

When `migraguard apply` runs, it checks for open Migration Groups. Files that depend (via DAG edges) on an open group are **blocked** from being applied until the group reaches terminal state (`contract_completed`).

```
Example:
  Group A (backfill_running) ← open
  Leaf B (depends on Group A:contract)
  Leaf C (independent of Group A)

  migraguard apply:
    → Group A expand: already applied → skip
    → Leaf B: blocked (Group A is open)
    → Leaf C: applied (independent)
```

## Baseline Squash

Over time, a project accumulates many applied migration files. The `baseline` command squashes them into `schema.sql`, keeping only recent files.

```bash
# Squash everything except leaf nodes
migraguard baseline

# Keep a specific file and everything after it
migraguard baseline --keep-since 20260315_100000__rename_username_to_handle

# Apply baseline schema to a fresh database
migraguard apply --from-baseline
```

Baseline history is recorded both in `schema.sql` (as comments) and in `metadata.json` (as structured data), providing a complete audit trail of which files were squashed and when.

Open Migration Groups (not yet `contract_completed`) are never included in a baseline.

## TypeScript Programmatic API

All expand/contract commands are available as typed functions for use by external executors:

```typescript
import {
  loadConfig,
  MigraguardDb,
  commandAdvance,
  commandApplyPhase,
  commandGroupStatus,
  commandGate,
} from 'migraguard';

const config = await loadConfig('/path/to/project');

// 1. Apply expand phase
await commandApplyPhase(config, {
  group: '20260315_100000__rename_username_to_handle',
  phase: 'expand',
});

// 2. Record backfill start
await commandAdvance(config, {
  group: '20260315_100000__rename_username_to_handle',
  phase: 'backfill',
  status: 'running',
});

// 3. Run backfill batches (executor responsibility)
// ...

// 4. Record backfill completion
await commandAdvance(config, {
  group: '20260315_100000__rename_username_to_handle',
  phase: 'backfill',
  status: 'completed',
});

// 5. Check deployment gate
const gateResult = await commandGate(config, {
  required: ['group:rename_username_to_handle.backfill_completed'],
  forbidden: [],
});
if (!gateResult.pass) {
  throw new Error(`Gate failed: ${gateResult.reasons.join(', ')}`);
}

// 6. Apply switch + contract
await commandApplyPhase(config, {
  group: '20260315_100000__rename_username_to_handle',
  phase: 'switch',
});
await commandApplyPhase(config, {
  group: '20260315_100000__rename_username_to_handle',
  phase: 'contract',
});
```

## CI/CD Integration

### Deployment Gate Architecture

The recommended integration model treats the migraguard state table as the **single source of truth** for schema evolution state. Infrastructure and application deployments evaluate deployability against this state rather than independently inferring migration progress.

```
┌─────────────────────────────────────────────────────┐
│                  Deployment Pipeline                 │
│                                                     │
│  1. Discover changed stacks/components              │
│  2. Build effective deployment target set            │
│  3. Aggregate requiredSchemaState / forbiddenState   │
│  4. ─── migraguard gate ────────────────────────►   │
│         Query schema_migrations table               │
│         Evaluate required/forbidden conditions       │
│         → PASS or FAIL                              │
│  5. If PASS → proceed with stack deployment         │
│  6. If FAIL → abort deployment                      │
└─────────────────────────────────────────────────────┘
```

### Schema Contract Declaration

Each deployable component declares its DB schema requirements in deployment metadata (e.g., `stack.json`):

```json
{
  "name": "user-service",
  "dependsOn": ["shared-vpc"],
  "requiredSchemaState": [
    "group:rename_username_to_handle.expand_applied"
  ],
  "forbiddenSchemaState": [
    "group:rename_username_to_handle.contract_completed"
  ]
}
```

This means:
- The user-service **requires** the new `handle` column to exist (expand applied).
- The user-service **cannot run** after the old `username` column has been dropped (contract completed) — it still reads from `username`.

A later version of user-service would flip this contract:

```json
{
  "requiredSchemaState": [
    "group:rename_username_to_handle.contract_completed"
  ]
}
```

### GitHub Actions: PR Check with Expand/Contract

```yaml
name: DB Migration Check
on:
  pull_request:
    paths: ['db/**']

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx migraguard lint
      - run: npx migraguard check
```

No changes needed — `lint` and `check` automatically handle Class B directories.

### GitHub Actions: Deployment with Schema Gate

```yaml
name: Deploy with Schema Gate
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci

      # Schema gate: fail fast if DB state is incompatible
      - name: Schema Gate
        run: npx migraguard gate --contract-file deploy/schema-requirements.json
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}

      # Apply safe DDL (expand phases auto-applied, backfill skipped)
      - name: Apply Migrations
        run: npx migraguard apply
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}

      # Deploy application
      - name: Deploy Application
        run: ./deploy.sh
```

### Backfill Executor Pipeline

Backfill is a long-running process that should be executed separately from the main deployment pipeline. A dedicated executor manages batch processing:

```yaml
name: Backfill Executor
on:
  workflow_dispatch:
    inputs:
      group:
        description: 'Migration group name'
        required: true
      batch_size:
        description: 'Rows per batch'
        default: '10000'

jobs:
  backfill:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci

      - name: Record backfill start
        run: npx migraguard advance ${{ inputs.group }} backfill running
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}

      - name: Execute backfill batches
        run: ./scripts/run-backfill.sh ${{ inputs.group }} ${{ inputs.batch_size }}
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}

      - name: Record backfill completion
        if: success()
        run: npx migraguard advance ${{ inputs.group }} backfill completed
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}

      - name: Record backfill failure
        if: failure()
        run: npx migraguard advance ${{ inputs.group }} backfill failed
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}
```

### Complete Lifecycle Example

A typical expand/contract lifecycle across deployments:

```
Day 1: PR merges expand + backfill + switch + contract files
  CI: lint + check pass
  Deploy v1.1: migraguard apply → expand applied
  App v1.1: reads username, trigger syncs to handle

Day 2: Backfill executor runs
  advance backfill running
  Execute batches (hours)
  advance backfill completed

Day 3: Deploy v1.2 (app reads handle)
  Schema gate: require expand_applied → PASS
  Schema gate: forbid contract_completed → PASS
  migraguard apply → switch applied
  App v1.2: reads handle, username still exists

Day 7: Deploy v1.3 (app no longer uses username)
  Schema gate: require contract_ready → PASS
  migraguard apply → contract completed
  App v1.3: reads handle only, username dropped
```

## Idempotency Patterns

Each phase must be idempotent. Here are the recommended patterns:

### Expand

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- IF NOT EXISTS for columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle VARCHAR(50);

-- OR REPLACE for functions/triggers
CREATE OR REPLACE FUNCTION sync_username_to_handle() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.handle IS NULL THEN
    NEW.handle := NEW.username;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync ON users;
CREATE TRIGGER trg_sync
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_username_to_handle();

RESET lock_timeout;
RESET statement_timeout;
```

### Backfill

```sql
SET statement_timeout = '300s';

UPDATE users
SET handle = username
WHERE handle IS NULL
  AND id BETWEEN :batch_start AND :batch_end;

RESET statement_timeout;
```

The `WHERE handle IS NULL` clause ensures already-backfilled rows are skipped on re-execution.

### Switch

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_handle_not_null'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_handle_not_null
      CHECK (handle IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

RESET lock_timeout;
RESET statement_timeout;
```

### Contract

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP TRIGGER IF EXISTS trg_sync ON users;
DROP FUNCTION IF EXISTS sync_username_to_handle();

-- migraguard:allow ban-drop-column
ALTER TABLE users DROP COLUMN IF EXISTS username;

RESET lock_timeout;
RESET statement_timeout;
```

## Responsibilities

| Concern | Owner |
|---------|-------|
| Phase file execution (native CLI) | migraguard (`apply`, `apply-phase`) |
| Prerequisite validation | migraguard (state machine) |
| State recording (`schema_migrations`) | migraguard (`advance`, `apply-phase`) |
| Advisory lock exclusion | migraguard |
| Batch range management | External executor |
| Retry strategy and scheduling | External executor |
| Progress monitoring | External executor |
| Deployment gate evaluation | `migraguard gate` |
| Schema contract declaration | Deployment metadata (`stack.json`) |
