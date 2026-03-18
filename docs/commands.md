# migraguard commands

## Migration management

### `migraguard new <name>`

Create a new migration SQL file with a local-timezone timestamp prefix.

```bash
migraguard new add_users_email_index
# → db/migrations/20260301_120000__add_users_email_index.sql

migraguard new --expand-contract rename_username_to_handle
# → db/migrations/20260301_120000__rename_username_to_handle/
#     1_expand.sql
#     2_backfill.sql
#     3_switch.sql
#     4_contract.sql
```

`--expand-contract` creates a Migration Group directory with four phase templates. See [docs/expand-contract.md](docs/expand-contract.md) for details.

### `migraguard squash`

Squash multiple new (unrecorded in metadata.json) migration files into a single file. Run before merging to a release branch.

```bash
migraguard squash
```

### `migraguard apply`

Apply pending migrations to the target DB via `psql`. Checks `schema_migrations` table for applied/failed/skipped status.

```bash
migraguard apply
migraguard apply --with-drift-check   # check schema drift before apply, update dump after
```

### `migraguard resolve <file>`

Mark a failed migration as skipped. Use when a subsequent forward migration covers the fix. Requires human judgment.

```bash
migraguard resolve 20260301_093000__add_user_email.sql
```

### `migraguard status`

Show the status of all migration files: applied, pending, failed, or skipped. Requires DB connection.

```bash
migraguard status
```

### `migraguard editable`

List migration files that are currently editable (modifiable and re-appliable). In the linear model this is the latest file; in the DAG model these are leaf nodes. With DB connection, also shows failed files eligible for retry.

```bash
migraguard editable
```

## Integrity checks

### `migraguard check`

Verify file integrity against metadata.json. No DB connection required. Checksums are computed on normalized SQL (comments stripped, whitespace collapsed), so comment-only or formatting changes do not trigger mismatches. Detects: checksum mismatches on non-latest files, mid-sequence insertions, and multiple new files (enforces squash).

```bash
migraguard check
```

### `migraguard lint`

Run built-in safety rules on all migration files. Rules use libpg-query AST analysis — no external tools required.

19 rules (all enabled by default). See README for the full table. Key categories:

**Idempotency**: `require-if-not-exists`, `require-create-or-replace-view`
**Concurrency safety**: `require-concurrent-index`, `require-drop-index-concurrently`, `ban-concurrent-index-in-transaction`
**Timeout discipline**: `require-lock-timeout`, `require-statement-timeout`, `require-reset-timeouts`
**Constraint safety**: `constraint-missing-not-valid`, `require-unique-via-concurrent-index`, `ban-validate-constraint-same-file`, `adding-not-nullable-field`
**Destructive DDL**: `ban-drop-column`, `ban-alter-column-type`, `ban-drop-cascade`, `ban-truncate`
**DML safety**: `ban-update-without-where`, `ban-delete-without-where`
**Statistics**: `require-analyze-after-index`

Configure severity per rule (`"error"` / `"warn"` / `"off"`) or add custom rules:
```json
{
  "lint": {
    "rules": { "ban-drop-column": "warn", "ban-alter-column-type": "off" },
    "customRulesDir": "lint-rules"
  }
}
```

Per-file exceptions via SQL comment: `-- migraguard:allow ban-drop-column`

Custom rule files (`.js` / `.mjs`) in the specified directory are loaded automatically. Each file must default-export a `LintRule` object. See README for an example.

```bash
migraguard lint
```

### `migraguard verify`

Verify migration idempotency using a shadow DB. Dumps the current DB schema, restores it to a temporary shadow database, then applies each pending migration twice — checking for errors and schema drift.

```bash
migraguard verify          # incremental: restore current DB, verify pending only
migraguard verify --all    # full: empty shadow, verify all migrations from scratch
```

## Schema management

### `migraguard dump`

Dump the current DB schema via `pg_dump --schema-only`, normalize it, and save as `schema.sql`.

```bash
migraguard dump
```

### `migraguard diff`

Show the diff between the current DB schema and the saved `schema.sql`.

```bash
migraguard diff
```

## Dependency analysis

### `migraguard deps`

Analyze and display the dependency graph between migration files.

```bash
migraguard deps
migraguard deps --html deps.html   # output as HTML with GitGraph.js visualization
```

## Expand/Contract commands

Commands for managing long-running Migration Groups. See [docs/expand-contract.md](docs/expand-contract.md) for the full guide.

### `migraguard group-status [group]`

Show the current state of Migration Groups (expand/contract phases).

```bash
migraguard group-status                                         # all groups
migraguard group-status 20260315_100000__rename_username_to_handle   # specific group
```

### `migraguard advance <group> <phase> <status>`

Record a phase state transition. Used by external executors to report progress.

Valid phases: `expand`, `backfill`, `switch`, `contract`.
Valid statuses: `running`, `completed`, `failed`.

```bash
migraguard advance 20260315_100000__rename_username_to_handle backfill running
migraguard advance 20260315_100000__rename_username_to_handle backfill completed
migraguard advance 20260315_100000__rename_username_to_handle backfill failed
```

### `migraguard apply-phase <group> <phase>`

Apply a specific phase of a Migration Group via `psql`. Validates prerequisites and acquires advisory lock.

```bash
migraguard apply-phase 20260315_100000__rename_username_to_handle expand
migraguard apply-phase 20260315_100000__rename_username_to_handle switch
migraguard apply-phase 20260315_100000__rename_username_to_handle contract
```

### `migraguard gate`

Evaluate deployment gate conditions against current Migration Group states. Exit code 0 = pass, 1 = fail.

```bash
migraguard gate \
  --require "group:rename_username_to_handle.expand_applied" \
  --forbid  "group:rename_username_to_handle.contract_completed"

migraguard gate --contract-file schema-requirements.json
```

### `migraguard baseline`

Squash applied migrations into `schema.sql`. Removes squashed files from disk and records the baseline in `metadata.json`.

```bash
migraguard baseline                                             # squash all except leaves
migraguard baseline --keep-since 20260315_100000__rename_username_to_handle  # keep from cutpoint
```

Open Migration Groups are excluded from baseline. Requires DB connection.
