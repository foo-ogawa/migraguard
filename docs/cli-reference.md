# migraguard CLI

PostgreSQL-first schema-aware deployment control — idempotent SQL migrations with CI-enforced integrity checks, expand/contract migration orchestration, schema drift detection, and unified gating across database, application, and infrastructure rollouts. MySQL and SQLite supported as secondary dialects.

**Version:** 0.8.3

## Table of Contents

- [migraguard](#migraguard)
  - [new](#migraguard-new)
  - [apply](#migraguard-apply)
  - [check](#migraguard-check)
  - [squash](#migraguard-squash)
  - [lint](#migraguard-lint)
  - [dump](#migraguard-dump)
  - [diff](#migraguard-diff)
  - [status](#migraguard-status)
  - [resolve](#migraguard-resolve)
  - [editable](#migraguard-editable)
  - [verify](#migraguard-verify)
  - [group-status](#migraguard-group-status)
  - [baseline](#migraguard-baseline)
  - [advance](#migraguard-advance)
  - [apply-phase](#migraguard-apply-phase)
  - [gate](#migraguard-gate)
  - [deps](#migraguard-deps)

---

## migraguard

Schema-aware deployment control for SQL migrations.

### Global Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--version` | -V | No |  | Print version and exit. |
| `--help` | -h | No |  | Show help and exit. |

### new

Create a new migration SQL file with UTC timestamp.

Generates a timestamped SQL migration file in the configured migrations directory. With --expand-contract, creates a migration group directory containing phased files (expand, backfill, switch, contract).

**Usage:**

```
migraguard new create_users_table
```
```
migraguard new --expand-contract rename_username_to_handle
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `name` | Yes | Migration name (alphanumeric and underscores). |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--expand-contract` |  | No | `false` | Create an expand/contract migration group (Class B). |

#### Exit Codes

**Exit 0:** Migration file (or group directory) created successfully.

- **stdout:** format=`text`

- **Generated files:**
  - `db/migrations/{timestamp}__{name}.sql` (application/sql) *(optional)*
  - `db/migrations/{timestamp}__{name}/1_expand.sql` (application/sql) *(optional)*

**Exit 1:** Creation failed (config error or naming conflict).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: false
  sideEffects: 
    - file_write
```

---

### apply

Apply pending migrations via native database CLI.

Executes pending migrations using the database's native CLI (psql, mysql, or sqlite3). Uses advisory locks to prevent concurrent execution. Records each application attempt in the schema_migrations table.

**Usage:**

```
migraguard apply
```
```
migraguard apply --with-drift-check
```
```
migraguard apply --from-baseline
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--with-drift-check` |  | No | `false` | Check schema drift before apply and update dump after. |
| `--from-baseline` |  | No | `false` | Apply schema.sql first, then remaining migrations. |

#### Exit Codes

**Exit 0:** All pending migrations applied successfully.

- **stdout:** format=`text`

**Exit 1:** Apply failed (migration error, drift detected, regression detected, or advisory lock conflict).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: high
  requiresConfirmation: true
  idempotent: false
  sideEffects: 
    - database_write
  recommendedBeforeUse: 
    - Run migraguard check to verify metadata integrity.
    - Run migraguard lint to check for unsafe DDL patterns.
    - Consider running with --with-drift-check for local development.
```

---

### check

Verify metadata integrity (no DB connection required).

Validates file list and checksums in metadata.json against the actual migration files on disk. Detects tampered, missing, or extra files. Runs offline without a database connection, making it suitable for CI/CD PR checks.

**Usage:**

```
migraguard check
```

#### Exit Codes

**Exit 0:** Metadata integrity verified. All checksums match.

- **stdout:** format=`text`

**Exit 1:** Integrity check failed (tampered, missing, or extra files).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### squash

Squash multiple new migration files into one.

Merges pending (unapplied) migration files into a single file for release. Ensures one release = one file, simplifying error recovery and hotfix workflows.

**Usage:**

```
migraguard squash
```

#### Exit Codes

**Exit 0:** Migration files squashed successfully.

- **stdout:** format=`text`

- **Generated files:**
  - `db/migrations/{timestamp}__{description}.sql` (application/sql)

**Exit 1:** Squash failed (nothing to squash or conflict).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: medium
  requiresConfirmation: false
  idempotent: false
  sideEffects: 
    - file_write
    - file_delete
  recommendedBeforeUse: 
    - Ensure all pending files are ready for release.
```

---

### lint

Run built-in safety rules on migration files.

Performs AST-based lint analysis on migration SQL files using libpg-query (38 rules for PostgreSQL) or node-sql-parser (17 generic rules for MySQL/SQLite). Detects unsafe DDL patterns such as missing IF NOT EXISTS, non-concurrent index creation, missing lock timeouts, and prohibited operations.

**Usage:**

```
migraguard lint
```

#### Exit Codes

**Exit 0:** All lint rules passed.

- **stdout:** format=`text`

**Exit 1:** Lint violations found.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### dump

Dump and normalize current DB schema.

Executes pg_dump (PostgreSQL), mysqldump (MySQL), or sqlite3 .schema (SQLite) to capture the current database schema, then normalizes the output and saves it to schema.sql.

**Usage:**

```
migraguard dump
```

#### Exit Codes

**Exit 0:** Schema dump saved successfully.

- **stdout:** format=`text`

- **Generated files:**
  - `db/schema.sql` (application/sql)

**Exit 1:** Dump failed (connection error or CLI not found).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - file_write
```

---

### diff

Show diff between current DB schema and saved schema.sql.

Dumps the current database schema, normalizes it, and compares it against the saved schema.sql file. Exits with code 1 if differences are found, enabling CI gating for schema drift.

**Usage:**

```
migraguard diff
```

#### Exit Codes

**Exit 0:** No differences found. DB schema matches schema.sql.

- **stdout:** format=`text`

**Exit 1:** Differences found between DB schema and schema.sql.

- **stdout:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### status

Show migration status (applied / pending / failed / skipped).

Queries the schema_migrations table and cross-references with migration files on disk to display the status of each migration.

**Usage:**

```
migraguard status
```

#### Exit Codes

**Exit 0:** Status displayed successfully.

- **stdout:** format=`text`

**Exit 1:** Failed to retrieve status (connection error).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### resolve

Mark a failed migration as skipped (requires human judgment).

Records a 'skipped' entry in schema_migrations for the specified failed migration file. This unblocks subsequent migrations but requires explicit human judgment that the failure has been addressed by other means.

**Usage:**

```
migraguard resolve 20260301_120000__create_users_table.sql
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `file` | Yes | Failed migration file name to resolve. |

#### Exit Codes

**Exit 0:** Migration marked as skipped.

- **stdout:** format=`text`

**Exit 1:** Resolve failed (file not found or not in failed state).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: high
  requiresConfirmation: true
  idempotent: false
  sideEffects: 
    - database_write
  recommendedBeforeUse: 
    - Verify that the failure has been addressed by a subsequent migration or manual fix.
    - Run migraguard status to confirm the file is in failed state.
```

---

### editable

List migration files that are currently editable.

Shows which migration files can be safely modified. In linear mode, only the tail file is editable. In DAG mode, all leaf nodes are editable.

**Usage:**

```
migraguard editable
```

#### Exit Codes

**Exit 0:** Editable files listed.

- **stdout:** format=`text`

**Exit 1:** Failed to determine editable files.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### verify

Verify migration idempotency using a shadow DB.

Creates a temporary shadow database, applies migrations twice, and confirms no errors or schema differences occur. Proves that migrations are safely re-executable. The shadow DB is dropped after verification.

**Usage:**

```
migraguard verify
```
```
migraguard verify --all
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--all` |  | No | `false` | Verify all migrations from scratch, not only pending. |

#### Exit Codes

**Exit 0:** All migrations verified as idempotent.

- **stdout:** format=`text`

**Exit 1:** One or more migrations failed idempotency verification.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - database_write
  recommendedBeforeUse: 
    - Ensure the database server is running and accessible.
```

---

### group-status

Show migration group state (expand/contract phases).

Displays the current phase state of migration groups. When a group name is specified, shows detailed state for that group. Without arguments, shows all groups.

**Usage:**

```
migraguard group-status
```
```
migraguard group-status rename_username_to_handle
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `group` | No | Specific group name. Shows all groups if omitted. |

#### Exit Codes

**Exit 0:** Group status displayed.

- **stdout:** format=`text`

**Exit 1:** Failed to retrieve group status.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### baseline

Squash applied migrations into schema.sql baseline.

Consolidates all applied migrations into schema.sql and removes the original files. Optionally keeps migration files from a specified point forward using --keep-since.

**Usage:**

```
migraguard baseline
```
```
migraguard baseline --keep-since 20260301_120000__create_users_table.sql
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--keep-since` |  | No |  | Keep migration files from this point forward. |

#### Exit Codes

**Exit 0:** Baseline created successfully.

- **stdout:** format=`text`

**Exit 1:** Baseline failed.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: high
  requiresConfirmation: true
  idempotent: false
  sideEffects: 
    - file_write
    - file_delete
  recommendedBeforeUse: 
    - Ensure all migrations have been applied to all environments.
    - Back up migration files before running.
```

---

### advance

Record a phase state transition (for external executor).

Updates the state of a migration group phase. Used by external executors to record phase transitions in the expand/contract workflow. Valid phases: expand, backfill, switch, contract. Valid statuses: running, completed, failed.

**Usage:**

```
migraguard advance rename_username_to_handle expand completed
```
```
migraguard advance rename_username_to_handle backfill running
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `group` | Yes | Migration group name. |
| `phase` | Yes | Phase to advance. |
| `status` | Yes | New status for the phase. |

#### Exit Codes

**Exit 0:** Phase state transition recorded.

- **stdout:** format=`text`

**Exit 1:** Advance failed (invalid phase/status, group not found, or invalid state transition).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: medium
  requiresConfirmation: true
  idempotent: false
  sideEffects: 
    - database_write
```

---

### apply-phase

Apply a specific phase of a migration group via native CLI.

Executes the SQL file for a specific phase of a migration group using the database's native CLI (psql, mysql, or sqlite3). Valid phases: expand, backfill, switch, contract.

**Usage:**

```
migraguard apply-phase rename_username_to_handle expand
```
```
migraguard apply-phase rename_username_to_handle contract
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `group` | Yes | Migration group name. |
| `phase` | Yes | Phase to apply. |

#### Exit Codes

**Exit 0:** Phase applied successfully.

- **stdout:** format=`text`

**Exit 1:** Phase apply failed (SQL error, group not found, or invalid phase for current state).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: high
  requiresConfirmation: true
  idempotent: false
  sideEffects: 
    - database_write
  recommendedBeforeUse: 
    - Run migraguard group-status to verify current phase state.
```

---

### gate

Evaluate deployment gate conditions against migration group states.

Checks whether the current migration group states satisfy the specified deployment gate conditions. Used in CI/CD pipelines to gate deployments on schema state. Conditions can be specified via CLI options or a JSON contract file.

**Usage:**

```
migraguard gate --require "group:rename_username_to_handle.expand_applied"
```
```
migraguard gate --forbid "group:rename_username_to_handle.contract_pending"
```
```
migraguard gate --contract-file deploy-gates.json
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--require` |  | No |  | Required schema state conditions. |
| `--forbid` |  | No |  | Forbidden schema state conditions. |
| `--contract-file` |  | No |  | JSON file with schema requirements. |

#### Exit Codes

**Exit 0:** All gate conditions satisfied.

- **stdout:** format=`text`

**Exit 1:** One or more gate conditions not satisfied.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

```

---

### deps

Analyze and display migration dependency graph.

Parses migration SQL files to extract object creation/reference relationships and builds a dependency graph. In DAG mode, shows the full dependency tree. Optionally outputs as an interactive HTML visualization.

**Usage:**

```
migraguard deps
```
```
migraguard deps --html deps.html
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--html` |  | No |  | Output as HTML file with interactive visualization. |

#### Exit Codes

**Exit 0:** Dependency graph displayed or HTML file generated.

- **stdout:** format=`text`

- **Generated files:**
  - `{options.html}` (text/html) *(optional)*

**Exit 1:** Dependency analysis failed.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - file_write
```

---
