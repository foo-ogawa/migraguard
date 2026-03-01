# migraguard commands

## Migration management

### `migraguard new <name>`

Create a new migration SQL file with a UTC timestamp prefix.

```bash
migraguard new add_users_email_index
# → db/migrations/20260301_120000__add_users_email_index.sql
```

### `migraguard squash`

Squash multiple new (unrecorded in metadata.json) migration files into a single file. Run before merging to a release branch.

```bash
migraguard squash
```

### `migraguard apply`

Apply pending migrations to the target DB via `psql`. Checks `schema_migrations` table for applied/failed/skipped status.

```bash
migraguard apply
migraguard apply --verify   # verify schema dump before and after
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

Run Squawk lint on migration files to detect idempotency and safety rule violations.

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

## Dependency analysis (extension)

### `migraguard deps`

Analyze and display the dependency graph between migration files.

```bash
migraguard deps
migraguard deps --html deps.html   # output as HTML with GitGraph.js visualization
```
