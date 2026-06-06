# migraguard CLI

PostgreSQL-first schema-aware deployment control — idempotent SQL migrations with CI-enforced integrity checks, expand/contract migration orchestration, schema drift detection, and unified gating across database, application, and infrastructure rollouts. MySQL and SQLite supported as secondary dialects.

**Version:** 0.12.0

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
  - [insights](#migraguard-insights)
  - [deps](#migraguard-deps)
  - [audit](#migraguard-audit)
  - [propose-expand-contract](#migraguard-propose-expand-contract)
  - [implement](#migraguard-implement)
  - [audit-workflow](#migraguard-audit-workflow)
  - [explain](#migraguard-explain)
  - [agents](#migraguard-agents)

---

## migraguard

Schema-aware deployment control for SQL migrations.

### Global Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--version` | -V | No |  | Print version and exit. |
| `--help` | -h | No |  | Show help and exit. |
| `--no-color` |  | No | `false` | Disable ANSI color output. Also respects NO_COLOR env var. |
| `--quiet` | -q | No | `false` | Suppress informational output. Does not suppress structured stdout or error messages. |
| `--config` | -c | No |  | Path to migraguard configuration file. |

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
| `--dry-run` | -n | No | `false` | Show what would be created without writing files. |

#### Exit Codes

**Exit 0:** Migration file (or group directory) created successfully (or dry-run preview completed).

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
  sideEffectNote: Creates migration SQL file(s) in the configured migrations directory.
  safeDryRunOption: dry-run
  expectedDurationMs: 1000
  retryableExitCodes: 

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
```
migraguard apply --dry-run
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--with-drift-check` |  | No | `false` | Check schema drift before apply and update dump after. |
| `--from-baseline` |  | No | `false` | Apply schema.sql first, then remaining migrations. |
| `--tag` |  | No |  | Tag to record with applied migrations (e.g. commit hash, release tag). |
| `--dry-run` | -n | No | `false` | List pending migrations and SQL that would be executed without applying. |

#### Exit Codes

**Exit 0:** All pending migrations applied successfully (or dry-run preview completed).

- **stdout:** format=`text`

**Exit 1:** Apply failed (migration error, drift detected, regression detected, or advisory lock conflict).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: high
  requiresConfirmation: true
  idempotent: false
  reversible: false
  rollbackGuidance: Migrations are not automatically reversible. Manual rollback requires writing a compensating migration or restoring from backup.
  sideEffects: 
    - database_write
  sideEffectNote: Executes SQL via native CLI and records results in schema_migrations. Uses advisory lock to prevent concurrent execution.
  safeDryRunOption: dry-run
  expectedDurationMs: 60000
  retryableExitCodes: 

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

**Exit 1:** Unexpected error (file read failure, parse error).

- **stderr:** format=`text`

**Exit 10:** Integrity check failed (tampered, missing, or extra files).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

  sideEffectNote: Read-only. Compares metadata.json against files on disk.
  expectedDurationMs: 2000
  retryableExitCodes: 

```

---

### squash

Squash multiple new migration files into one.

Merges pending (unapplied) migration files into a single file for release. Ensures one release = one file, simplifying error recovery and hotfix workflows. Original migration files are deleted.

**Usage:**

```
migraguard squash
```
```
migraguard squash --dry-run
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--dry-run` | -n | No | `false` | Show what would be squashed without writing files. |

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
  requiresConfirmation: true
  idempotent: false
  reversible: false
  rollbackGuidance: Deleted files can be recovered from version control (git checkout). Re-run migraguard new to recreate individual files if needed.
  sideEffects: 
    - file_write
    - file_delete
  sideEffectNote: Merges migration files into one and deletes originals. Updates metadata.json.
  safeDryRunOption: dry-run
  expectedDurationMs: 3000
  retryableExitCodes: 

  recommendedBeforeUse: 
    - Ensure all pending files are ready for release.
    - Confirm no uncommitted changes to migration files.
```

---

### lint

Run built-in safety rules on migration files.

Performs AST-based lint analysis on migration SQL files using libpg-query (38 rules for PostgreSQL) or node-sql-parser (17 generic rules for MySQL/SQLite). Detects unsafe DDL patterns such as missing IF NOT EXISTS, non-concurrent index creation, missing lock timeouts, and prohibited operations.

**Usage:**

```
migraguard lint
```
```
migraguard lint --format json
```
```
migraguard lint --format json | migraguard explain
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--format` |  | No | `"text"` | Output format for lint results. |

#### Exit Codes

**Exit 0:** All lint rules passed.

- **stdout:** format=`{options.format}`

**Exit 1:** Unexpected error (e.g. file parse failure).

- **stderr:** format=`text`

**Exit 10:** Lint violations found.

- **stdout:** format=`{options.format}`

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

  sideEffectNote: Read-only. Scans migration files against safety rules.
  expectedDurationMs: 3000
  retryableExitCodes: 

```

---

### dump

Dump and normalize current DB schema.

Executes pg_dump (PostgreSQL), mysqldump (MySQL), or sqlite3 .schema (SQLite) to capture the current database schema, then normalizes the output and saves it to schema.sql.

**Usage:**

```
migraguard dump
```
```
migraguard dump --dry-run
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--dry-run` | -n | No | `false` | Output normalized schema to stdout without writing schema.sql. |

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
    - database_read
    - file_write
  sideEffectNote: Reads DB schema via pg_dump/mysqldump and writes normalized output to schema.sql.
  safeDryRunOption: dry-run
  expectedDurationMs: 10000
  retryableExitCodes: 
    - 1
```

---

### diff

Show diff between current DB schema and saved schema.sql.

Dumps the current database schema, normalizes it, and compares it against the saved schema.sql file. Exits with code 10 if differences are found, enabling CI gating for schema drift.

**Usage:**

```
migraguard diff
```
```
migraguard diff --format json
```
```
migraguard diff --format json | migraguard explain
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--format` |  | No | `"text"` | Output format for diff results. |

#### Exit Codes

**Exit 0:** No differences found. DB schema matches schema.sql.

- **stdout:** format=`{options.format}`

**Exit 1:** Unexpected error (connection error, schema.sql not found).

- **stderr:** format=`text`

**Exit 10:** Differences found between DB schema and schema.sql.

- **stdout:** format=`{options.format}`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - database_read
  sideEffectNote: Reads DB schema via pg_dump/mysqldump and compares with saved schema.sql. No writes.
  expectedDurationMs: 10000
  retryableExitCodes: 
    - 1
```

---

### status

Show migration status (applied / pending / failed / skipped).

Queries the schema_migrations table and cross-references with migration files on disk to display the status of each migration.

**Usage:**

```
migraguard status
```
```
migraguard status --format json
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--format` |  | No | `"text"` | Output format for status results. |

#### Exit Codes

**Exit 0:** Status displayed successfully.

- **stdout:** format=`{options.format}`

**Exit 1:** Failed to retrieve status (connection error).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - database_read
  sideEffectNote: Reads schema_migrations table and compares with local files.
  expectedDurationMs: 5000
  retryableExitCodes: 
    - 1
```

---

### resolve

Mark a failed migration as skipped (requires human judgment).

Records a 'skipped' entry in schema_migrations for the specified failed migration file. This unblocks subsequent migrations but requires explicit human judgment that the failure has been addressed by other means.

**Usage:**

```
migraguard resolve 20260301_120000__create_users_table.sql
```
```
migraguard resolve --dry-run 20260301_120000__create_users_table.sql
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `file` | Yes | Failed migration file name to resolve. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--dry-run` | -n | No | `false` | Show what would be resolved without writing to DB. |

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
  reversible: false
  rollbackGuidance: A resolved (skipped) migration cannot be un-resolved. Re-apply the migration manually if needed.
  sideEffects: 
    - database_write
  sideEffectNote: Inserts a 'skipped' record into schema_migrations for the given file.
  safeDryRunOption: dry-run
  expectedDurationMs: 3000
  retryableExitCodes: 
    - 1
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

  sideEffectNote: Read-only. Lists leaf/latest migration files from metadata.
  expectedDurationMs: 1000
  retryableExitCodes: 

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
```
migraguard verify --format json
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--all` |  | No | `false` | Verify all migrations from scratch, not only pending. |
| `--format` |  | No | `"text"` | Output format for verification results. |

#### Exit Codes

**Exit 0:** All migrations verified as idempotent.

- **stdout:** format=`{options.format}`

**Exit 1:** Unexpected error (connection error, file parse failure).

- **stderr:** format=`text`

**Exit 10:** One or more migrations failed idempotency verification.

- **stdout:** format=`{options.format}`

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: medium
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - database_read
    - database_write
  sideEffectNote: Creates and destroys a temporary shadow database to verify idempotency. Does not modify the primary database.
  expectedDurationMs: 60000
  retryableExitCodes: 
    - 1
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

  sideEffectNote: Read-only. Derives group state from schema_migrations records.
  expectedDurationMs: 3000
  retryableExitCodes: 
    - 1
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
```
migraguard baseline --dry-run
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--keep-since` |  | No |  | Keep migration files from this point forward. |
| `--dry-run` | -n | No | `false` | Show what would be baselined without writing files. |

#### Exit Codes

**Exit 0:** Baseline created successfully (or dry-run preview completed).

- **stdout:** format=`text`

**Exit 1:** Baseline failed.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: high
  requiresConfirmation: true
  idempotent: false
  reversible: false
  rollbackGuidance: Deleted migration files can only be recovered from version control. The baseline operation cannot be undone programmatically.
  sideEffects: 
    - file_write
    - file_delete
  sideEffectNote: Dumps current DB schema to schema.sql, deletes squashed migration files, updates metadata.json, and rewrites depends-on references.
  safeDryRunOption: dry-run
  expectedDurationMs: 30000
  retryableExitCodes: 

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

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--tag` |  | No |  | Tag to record (e.g. commit hash, release tag). |
| `--dry-run` | -n | No | `false` | Show what would be recorded without writing to DB. |

#### Exit Codes

**Exit 0:** Phase state transition recorded (or dry-run preview completed).

- **stdout:** format=`text`

**Exit 1:** Advance failed (invalid phase/status, group not found, or invalid state transition).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: medium
  requiresConfirmation: true
  idempotent: false
  reversible: false
  rollbackGuidance: State transitions cannot be undone. Use advance with the previous status value to manually correct, or reset group state in the database.
  sideEffects: 
    - database_write
  sideEffectNote: Inserts a phase state transition record into schema_migrations.
  safeDryRunOption: dry-run
  expectedDurationMs: 5000
  retryableExitCodes: 
    - 1
  recommendedBeforeUse: 
    - Run migraguard group-status <group> to verify current phase state before advancing.
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

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--tag` |  | No |  | Tag to record (e.g. commit hash, release tag). |
| `--dry-run` | -n | No | `false` | Show what would be applied without executing SQL. |

#### Exit Codes

**Exit 0:** Phase applied successfully (or dry-run preview completed).

- **stdout:** format=`text`

**Exit 1:** Phase apply failed (SQL error, group not found, or invalid phase for current state).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: high
  requiresConfirmation: true
  idempotent: false
  reversible: false
  rollbackGuidance: Phase execution is not automatically reversible. Write a compensating migration or restore from backup if rollback is needed.
  sideEffects: 
    - database_write
  sideEffectNote: Executes a phase SQL file via native CLI and records the result in schema_migrations. Uses advisory lock.
  safeDryRunOption: dry-run
  expectedDurationMs: 30000
  retryableExitCodes: 

  recommendedBeforeUse: 
    - Run migraguard group-status to verify current phase state.
```

---

### gate

Evaluate deployment gate conditions against migration group states.

Checks whether the current migration group states satisfy the specified deployment gate conditions. Used in CI/CD pipelines to gate deployments on schema state. Conditions use the syntax "group:<name>.<condition>" where condition is one of: expand_applied, backfill_applied, switch_applied, contract_applied, expand_pending, backfill_pending, switch_pending, contract_pending.

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
| `--require` |  | No |  | Required schema state conditions. Syntax: group:<name>.<condition> |
| `--forbid` |  | No |  | Forbidden schema state conditions. Syntax: group:<name>.<condition> |
| `--contract-file` |  | No |  | JSON file with schema requirements. |

#### Exit Codes

**Exit 0:** All gate conditions satisfied.

- **stdout:** format=`text`

**Exit 1:** Unexpected error (connection error, invalid condition syntax).

- **stderr:** format=`text`

**Exit 10:** One or more gate conditions not satisfied.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

  sideEffectNote: Read-only. Evaluates gate conditions against schema_migrations state.
  expectedDurationMs: 5000
  retryableExitCodes: 
    - 1
```

---

### insights

Export migration dependency graph as ExternalInsight JSON.

Builds the migration DAG and outputs agent-contracts-analyzer ExternalInsight JSON to stdout for programmatic integration.

**Usage:**

```
migraguard insights --format json
```
```
migraguard insights --format json --project-root .
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--format` |  | No | `"json"` | Output format for insight results. |
| `--project-root` |  | No | `"."` | Project root directory containing migraguard.config.json. |

#### Exit Codes

**Exit 0:** ExternalInsight JSON written to stdout.

- **stdout:** format=`json`

**Exit 1:** Insight export failed.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 

  sideEffectNote: Read-only. Emits structured JSON to stdout.
  expectedDurationMs: 5000
  retryableExitCodes: 
    - 1
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
| `--html` |  | No |  | Output as HTML file with interactive visualization. File is created or overwritten at the specified path. Parent directory must exist. |

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
  sideEffectNote: Reads migration files and outputs dependency graph. Writes HTML file only when --html is specified.
  expectedDurationMs: 3000
  retryableExitCodes: 

```

---

### audit

Run LLM-based migration safety audit.

Performs semantic analysis of migration SQL using LLM to identify operational risks that AST-based lint cannot detect. Checks lock risks, expand/contract necessity, backfill safety, deployment ordering, and allow-directive validity. Requires agent-contracts-runtime as an optional peer dependency.

**Usage:**

```
migraguard audit db/migrations/20260510_120000__add_user_status.sql
```
```
migraguard audit db/migrations/
```
```
migraguard audit --adapter gemini --show-prompt
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `target` | No | Migration file or directory to audit. Defaults to pending migrations. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--adapter` | -a | No |  | SDK adapter to use for LLM execution. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"json"` | Output format for the audit report. |
| `--show-prompt` |  | No | `false` | Output the constructed prompt without calling the LLM API. |
| `--log-file` | -l | No |  | Write agent progress log to this file path. |

#### Exit Codes

**Exit 0:** Audit completed, no blocking findings.

- **stdout:** format=`{options.report-format}`

  | Property | Type | Required | Description |
  |---|---|---|---|
  | `summary` | `string` | Yes |  |
  | `riskLevel` | `"low" \| "medium" \| "high" \| "critical"` | Yes |  |
  | `findings` | `object[]` | Yes |  |
  | `findings[].id` | `string` | No | Unique finding identifier. |
  | `findings[].severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
  | `findings[].category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
  | `findings[].target` | `string` | No | Target of the finding (command ID, schema path). |
  | `findings[].location` | `string` | No | Location within the target. |
  | `findings[].message` | `string` | Yes |  |
  | `findings[].recommendation` | `string` | No |  |
  | `findings[].confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
  | `findings[].evidence` | `object[]` | No |  |
  | `findings[].evidence[].kind` | `enum(7 values)` | Yes |  |
  | `findings[].evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
  | `findings[].evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
  | `findings[].evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
  | `findings[].details` | `Record<string, any>` | No |  |
  | `recommendedActions` | `object[]` | No |  |
  | `recommendedActions[].kind` | `enum(6 values)` | Yes |  |
  | `recommendedActions[].title` | `string` | Yes |  |
  | `recommendedActions[].command` | `string` | No | CLI command to run (for run_command kind). |
  | `recommendedActions[].target` | `string` | No | Target file or resource. |
  | `recommendedActions[].rationale` | `string` | No |  |
  | `metadata` | `object` | No |  |
  | `metadata.tool` | `string` | No |  |
  | `metadata.command` | `string` | No |  |
  | `metadata.version` | `string` | No |  |
  | `metadata.generatedAt` | `string` | No |  |
  | `metadata.adapter` | `string` | No |  |
  | `metadata.model` | `string` | No |  |

  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
    "required": [
      "summary",
      "riskLevel",
      "findings"
    ],
    "properties": {
      "summary": {
        "type": "string"
      },
      "riskLevel": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high",
          "critical"
        ]
      },
      "findings": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A single finding from an agent audit or analysis.",
          "required": [
            "severity",
            "category",
            "message"
          ],
          "properties": {
            "id": {
              "type": "string",
              "description": "Unique finding identifier."
            },
            "severity": {
              "type": "string",
              "enum": [
                "info",
                "warning",
                "error",
                "critical"
              ]
            },
            "category": {
              "type": "string",
              "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
            },
            "target": {
              "type": "string",
              "description": "Target of the finding (command ID, schema path)."
            },
            "location": {
              "type": "string",
              "description": "Location within the target."
            },
            "message": {
              "type": "string"
            },
            "recommendation": {
              "type": "string"
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1,
              "description": "Confidence score (0-1) for LLM-generated findings."
            },
            "evidence": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "Evidence supporting an agent finding.",
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "file",
                      "command",
                      "schema",
                      "diff",
                      "stdout",
                      "stderr",
                      "text"
                    ]
                  },
                  "target": {
                    "type": "string",
                    "description": "Target identifier (file path, command ID, schema name)."
                  },
                  "location": {
                    "type": "string",
                    "description": "Location within the target (line number, JSON pointer)."
                  },
                  "excerpt": {
                    "type": "string",
                    "description": "Relevant excerpt from the target."
                  }
                }
              }
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "recommendedActions": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A recommended action from an agent audit.",
          "required": [
            "kind",
            "title"
          ],
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "run_command",
                "edit_file",
                "review",
                "confirm",
                "block",
                "ignore"
              ]
            },
            "title": {
              "type": "string"
            },
            "command": {
              "type": "string",
              "description": "CLI command to run (for run_command kind)."
            },
            "target": {
              "type": "string",
              "description": "Target file or resource."
            },
            "rationale": {
              "type": "string"
            }
          }
        }
      },
      "metadata": {
        "type": "object",
        "properties": {
          "tool": {
            "type": "string"
          },
          "command": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "generatedAt": {
            "type": "string"
          },
          "adapter": {
            "type": "string"
          },
          "model": {
            "type": "string"
          }
        }
      }
    }
  }
  ```

  </details>

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Validation or configuration error.

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`

  | Property | Type | Required | Description |
  |---|---|---|---|
  | `summary` | `string` | Yes |  |
  | `riskLevel` | `"low" \| "medium" \| "high" \| "critical"` | Yes |  |
  | `findings` | `object[]` | Yes |  |
  | `findings[].id` | `string` | No | Unique finding identifier. |
  | `findings[].severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
  | `findings[].category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
  | `findings[].target` | `string` | No | Target of the finding (command ID, schema path). |
  | `findings[].location` | `string` | No | Location within the target. |
  | `findings[].message` | `string` | Yes |  |
  | `findings[].recommendation` | `string` | No |  |
  | `findings[].confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
  | `findings[].evidence` | `object[]` | No |  |
  | `findings[].evidence[].kind` | `enum(7 values)` | Yes |  |
  | `findings[].evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
  | `findings[].evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
  | `findings[].evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
  | `findings[].details` | `Record<string, any>` | No |  |
  | `recommendedActions` | `object[]` | No |  |
  | `recommendedActions[].kind` | `enum(6 values)` | Yes |  |
  | `recommendedActions[].title` | `string` | Yes |  |
  | `recommendedActions[].command` | `string` | No | CLI command to run (for run_command kind). |
  | `recommendedActions[].target` | `string` | No | Target file or resource. |
  | `recommendedActions[].rationale` | `string` | No |  |
  | `metadata` | `object` | No |  |
  | `metadata.tool` | `string` | No |  |
  | `metadata.command` | `string` | No |  |
  | `metadata.version` | `string` | No |  |
  | `metadata.generatedAt` | `string` | No |  |
  | `metadata.adapter` | `string` | No |  |
  | `metadata.model` | `string` | No |  |

  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
    "required": [
      "summary",
      "riskLevel",
      "findings"
    ],
    "properties": {
      "summary": {
        "type": "string"
      },
      "riskLevel": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high",
          "critical"
        ]
      },
      "findings": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A single finding from an agent audit or analysis.",
          "required": [
            "severity",
            "category",
            "message"
          ],
          "properties": {
            "id": {
              "type": "string",
              "description": "Unique finding identifier."
            },
            "severity": {
              "type": "string",
              "enum": [
                "info",
                "warning",
                "error",
                "critical"
              ]
            },
            "category": {
              "type": "string",
              "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
            },
            "target": {
              "type": "string",
              "description": "Target of the finding (command ID, schema path)."
            },
            "location": {
              "type": "string",
              "description": "Location within the target."
            },
            "message": {
              "type": "string"
            },
            "recommendation": {
              "type": "string"
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1,
              "description": "Confidence score (0-1) for LLM-generated findings."
            },
            "evidence": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "Evidence supporting an agent finding.",
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "file",
                      "command",
                      "schema",
                      "diff",
                      "stdout",
                      "stderr",
                      "text"
                    ]
                  },
                  "target": {
                    "type": "string",
                    "description": "Target identifier (file path, command ID, schema name)."
                  },
                  "location": {
                    "type": "string",
                    "description": "Location within the target (line number, JSON pointer)."
                  },
                  "excerpt": {
                    "type": "string",
                    "description": "Relevant excerpt from the target."
                  }
                }
              }
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "recommendedActions": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A recommended action from an agent audit.",
          "required": [
            "kind",
            "title"
          ],
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "run_command",
                "edit_file",
                "review",
                "confirm",
                "block",
                "ignore"
              ]
            },
            "title": {
              "type": "string"
            },
            "command": {
              "type": "string",
              "description": "CLI command to run (for run_command kind)."
            },
            "target": {
              "type": "string",
              "description": "Target file or resource."
            },
            "rationale": {
              "type": "string"
            }
          }
        }
      },
      "metadata": {
        "type": "object",
        "properties": {
          "tool": {
            "type": "string"
          },
          "command": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "generatedAt": {
            "type": "string"
          },
          "adapter": {
            "type": "string"
          },
          "model": {
            "type": "string"
          }
        }
      }
    }
  }
  ```

  </details>

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  dsl_workflow: migration-audit
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - network
  sideEffectNote: Network calls to LLM provider when adapter is not mock. Filesystem write only when --output is specified.
  safeDryRunOption: show-prompt
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### propose-expand-contract

Propose expand/contract migration group from unsafe DDL.

Analyzes a migration file containing potentially unsafe DDL (renames, type changes, drops) and proposes a phased expand/contract migration group with SQL for each phase. Requires agent-contracts-runtime.

**Usage:**

```
migraguard propose-expand-contract db/migrations/20260510__rename_username.sql
```
```
migraguard propose-expand-contract --output-dir ./proposed/ --show-prompt
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `file` | Yes | Migration file to decompose into expand/contract phases. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--output-dir` |  | No |  | Directory to write proposed phase files. |
| `--adapter` | -a | No |  | SDK adapter to use. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"json"` | Output format for the proposal report. |
| `--show-prompt` |  | No | `false` | Output the constructed prompt without calling the LLM API. |
| `--log-file` | -l | No |  | Write agent progress log to this file path. |

#### Exit Codes

**Exit 0:** Proposal generated successfully.

- **stdout:** format=`{options.report-format}`


  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Result from propose-expand-contract command. Contains the proposed phased migration group with SQL for each phase.",
    "allOf": [
      {
        "type": "object",
        "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
        "required": [
          "summary",
          "riskLevel",
          "findings"
        ],
        "properties": {
          "summary": {
            "type": "string"
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ]
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            }
          },
          "metadata": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "command": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "generatedAt": {
                "type": "string"
              },
              "adapter": {
                "type": "string"
              },
              "model": {
                "type": "string"
              }
            }
          }
        }
      },
      {
        "type": "object",
        "required": [
          "phases"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "description": "Overview of the proposed decomposition."
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ],
            "description": "Risk level of the original unsafe DDL."
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            },
            "description": "Issues found in the original migration."
          },
          "phases": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "name",
                "sql",
                "description"
              ],
              "properties": {
                "name": {
                  "type": "string",
                  "enum": [
                    "expand",
                    "backfill",
                    "switch",
                    "contract"
                  ]
                },
                "sql": {
                  "type": "string",
                  "description": "SQL content for this phase."
                },
                "description": {
                  "type": "string",
                  "description": "Human-readable description of what this phase does."
                },
                "deploymentGate": {
                  "type": "string",
                  "description": "Gate condition to verify before proceeding to next phase."
                }
              }
            },
            "description": "Ordered list of migration phases."
          }
        }
      }
    ]
  }
  ```

  </details>

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Validation or configuration error.

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`


  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Result from propose-expand-contract command. Contains the proposed phased migration group with SQL for each phase.",
    "allOf": [
      {
        "type": "object",
        "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
        "required": [
          "summary",
          "riskLevel",
          "findings"
        ],
        "properties": {
          "summary": {
            "type": "string"
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ]
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            }
          },
          "metadata": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "command": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "generatedAt": {
                "type": "string"
              },
              "adapter": {
                "type": "string"
              },
              "model": {
                "type": "string"
              }
            }
          }
        }
      },
      {
        "type": "object",
        "required": [
          "phases"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "description": "Overview of the proposed decomposition."
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ],
            "description": "Risk level of the original unsafe DDL."
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            },
            "description": "Issues found in the original migration."
          },
          "phases": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "name",
                "sql",
                "description"
              ],
              "properties": {
                "name": {
                  "type": "string",
                  "enum": [
                    "expand",
                    "backfill",
                    "switch",
                    "contract"
                  ]
                },
                "sql": {
                  "type": "string",
                  "description": "SQL content for this phase."
                },
                "description": {
                  "type": "string",
                  "description": "Human-readable description of what this phase does."
                },
                "deploymentGate": {
                  "type": "string",
                  "description": "Gate condition to verify before proceeding to next phase."
                }
              }
            },
            "description": "Ordered list of migration phases."
          }
        }
      }
    ]
  }
  ```

  </details>

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  dsl_workflow: expand-contract-proposal
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - network
    - file_write
  sideEffectNote: Network calls to LLM provider when adapter is not mock. Filesystem write when --output or --output-dir is specified.
  safeDryRunOption: show-prompt
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### implement

Generate production-safe migration SQL from a natural language description.

Accepts a natural language description of a schema change and generates correct migration SQL applying all of migraguard's safe DDL patterns: CREATE INDEX CONCURRENTLY, ANALYZE, IF NOT EXISTS, lock_timeout, statement_timeout, NOT VALID + VALIDATE separation, and UNIQUE via CREATE UNIQUE INDEX CONCURRENTLY + ADD CONSTRAINT USING INDEX. Predicts lint results and outputs the lint → apply → dump workflow as recommendedActions. Requires agent-contracts-runtime.

**Usage:**

```
migraguard implement "add email verification token to users table"
```
```
migraguard implement --adapter claude "create index on users.email"
```
```
migraguard implement --output-dir db/migrations/ "add status column"
```
```
migraguard implement --show-prompt "drop old_column"
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `description` | Yes | Natural language description of the desired schema change. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--output-dir` |  | No |  | Directory to write generated migration file(s). |
| `--adapter` | -a | No |  | SDK adapter to use for LLM execution. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"json"` | Output format for the implementation report. |
| `--show-prompt` |  | No | `false` | Output the constructed prompt without calling the LLM API. |
| `--log-file` | -l | No |  | Write agent progress log to this file path. |

#### Exit Codes

**Exit 0:** Migration SQL generated successfully, no blocking findings.

- **stdout:** format=`{options.report-format}`


  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Result from implement command. Contains generated migration SQL files following safe DDL patterns, predicted lint findings, and recommended workflow steps.",
    "allOf": [
      {
        "type": "object",
        "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
        "required": [
          "summary",
          "riskLevel",
          "findings"
        ],
        "properties": {
          "summary": {
            "type": "string"
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ]
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            }
          },
          "metadata": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "command": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "generatedAt": {
                "type": "string"
              },
              "adapter": {
                "type": "string"
              },
              "model": {
                "type": "string"
              }
            }
          }
        }
      },
      {
        "type": "object",
        "required": [
          "migrations"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "description": "One-line summary of what the generated migration(s) will do."
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ],
            "description": "Risk level of the requested schema change."
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            },
            "description": "Predicted lint violations (should be empty for correctly generated SQL)."
          },
          "migrations": {
            "type": "array",
            "description": "Generated migration files.",
            "items": {
              "type": "object",
              "required": [
                "fileName",
                "sql",
                "description"
              ],
              "properties": {
                "fileName": {
                  "type": "string",
                  "description": "Migration file name following YYYYMMDD_HHMMSS__description.sql convention."
                },
                "sql": {
                  "type": "string",
                  "description": "Full SQL content of the migration file."
                },
                "description": {
                  "type": "string",
                  "description": "Human-readable description of what this migration does."
                },
                "phase": {
                  "type": "string",
                  "enum": [
                    "expand",
                    "backfill",
                    "switch",
                    "contract"
                  ],
                  "description": "Expand/contract phase assignment. Only set when the migration is part of a phased group."
                }
              }
            }
          }
        }
      }
    ]
  }
  ```

  </details>

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Validation or configuration error.

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`


  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Result from implement command. Contains generated migration SQL files following safe DDL patterns, predicted lint findings, and recommended workflow steps.",
    "allOf": [
      {
        "type": "object",
        "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
        "required": [
          "summary",
          "riskLevel",
          "findings"
        ],
        "properties": {
          "summary": {
            "type": "string"
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ]
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            }
          },
          "metadata": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "command": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "generatedAt": {
                "type": "string"
              },
              "adapter": {
                "type": "string"
              },
              "model": {
                "type": "string"
              }
            }
          }
        }
      },
      {
        "type": "object",
        "required": [
          "migrations"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "description": "One-line summary of what the generated migration(s) will do."
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ],
            "description": "Risk level of the requested schema change."
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            },
            "description": "Predicted lint violations (should be empty for correctly generated SQL)."
          },
          "migrations": {
            "type": "array",
            "description": "Generated migration files.",
            "items": {
              "type": "object",
              "required": [
                "fileName",
                "sql",
                "description"
              ],
              "properties": {
                "fileName": {
                  "type": "string",
                  "description": "Migration file name following YYYYMMDD_HHMMSS__description.sql convention."
                },
                "sql": {
                  "type": "string",
                  "description": "Full SQL content of the migration file."
                },
                "description": {
                  "type": "string",
                  "description": "Human-readable description of what this migration does."
                },
                "phase": {
                  "type": "string",
                  "enum": [
                    "expand",
                    "backfill",
                    "switch",
                    "contract"
                  ],
                  "description": "Expand/contract phase assignment. Only set when the migration is part of a phased group."
                }
              }
            }
          }
        }
      }
    ]
  }
  ```

  </details>

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  dsl_workflow: migration-implementation
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - network
    - file_write
  sideEffectNote: Network calls to LLM provider when adapter is not mock. Filesystem write when --output or --output-dir is specified.
  safeDryRunOption: show-prompt
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### audit-workflow

Audit migration workflow compliance using LLM.

Analyzes the project's migration workflow for compliance with migraguard best practices. Checks whether migration files use safe DDL patterns (CONCURRENTLY, ANALYZE, IF NOT EXISTS, lock_timeout), whether schema.sql is machine-generated by migraguard dump, whether metadata.json is consistent, whether expand/contract group transitions are valid, and whether the lint → apply → dump workflow is being followed. Requires agent-contracts-runtime.

**Usage:**

```
migraguard audit-workflow
```
```
migraguard audit-workflow --adapter gemini
```
```
migraguard audit-workflow --report-format text
```
```
migraguard audit-workflow --show-prompt
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--adapter` | -a | No |  | SDK adapter to use for LLM execution. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"json"` | Output format for the audit report. |
| `--show-prompt` |  | No | `false` | Output the constructed prompt without calling the LLM API. |
| `--log-file` | -l | No |  | Write agent progress log to this file path. |

#### Exit Codes

**Exit 0:** Audit completed, no blocking findings.

- **stdout:** format=`{options.report-format}`

  | Property | Type | Required | Description |
  |---|---|---|---|
  | `summary` | `string` | Yes |  |
  | `riskLevel` | `"low" \| "medium" \| "high" \| "critical"` | Yes |  |
  | `findings` | `object[]` | Yes |  |
  | `findings[].id` | `string` | No | Unique finding identifier. |
  | `findings[].severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
  | `findings[].category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
  | `findings[].target` | `string` | No | Target of the finding (command ID, schema path). |
  | `findings[].location` | `string` | No | Location within the target. |
  | `findings[].message` | `string` | Yes |  |
  | `findings[].recommendation` | `string` | No |  |
  | `findings[].confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
  | `findings[].evidence` | `object[]` | No |  |
  | `findings[].evidence[].kind` | `enum(7 values)` | Yes |  |
  | `findings[].evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
  | `findings[].evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
  | `findings[].evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
  | `findings[].details` | `Record<string, any>` | No |  |
  | `recommendedActions` | `object[]` | No |  |
  | `recommendedActions[].kind` | `enum(6 values)` | Yes |  |
  | `recommendedActions[].title` | `string` | Yes |  |
  | `recommendedActions[].command` | `string` | No | CLI command to run (for run_command kind). |
  | `recommendedActions[].target` | `string` | No | Target file or resource. |
  | `recommendedActions[].rationale` | `string` | No |  |
  | `metadata` | `object` | No |  |
  | `metadata.tool` | `string` | No |  |
  | `metadata.command` | `string` | No |  |
  | `metadata.version` | `string` | No |  |
  | `metadata.generatedAt` | `string` | No |  |
  | `metadata.adapter` | `string` | No |  |
  | `metadata.model` | `string` | No |  |

  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
    "required": [
      "summary",
      "riskLevel",
      "findings"
    ],
    "properties": {
      "summary": {
        "type": "string"
      },
      "riskLevel": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high",
          "critical"
        ]
      },
      "findings": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A single finding from an agent audit or analysis.",
          "required": [
            "severity",
            "category",
            "message"
          ],
          "properties": {
            "id": {
              "type": "string",
              "description": "Unique finding identifier."
            },
            "severity": {
              "type": "string",
              "enum": [
                "info",
                "warning",
                "error",
                "critical"
              ]
            },
            "category": {
              "type": "string",
              "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
            },
            "target": {
              "type": "string",
              "description": "Target of the finding (command ID, schema path)."
            },
            "location": {
              "type": "string",
              "description": "Location within the target."
            },
            "message": {
              "type": "string"
            },
            "recommendation": {
              "type": "string"
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1,
              "description": "Confidence score (0-1) for LLM-generated findings."
            },
            "evidence": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "Evidence supporting an agent finding.",
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "file",
                      "command",
                      "schema",
                      "diff",
                      "stdout",
                      "stderr",
                      "text"
                    ]
                  },
                  "target": {
                    "type": "string",
                    "description": "Target identifier (file path, command ID, schema name)."
                  },
                  "location": {
                    "type": "string",
                    "description": "Location within the target (line number, JSON pointer)."
                  },
                  "excerpt": {
                    "type": "string",
                    "description": "Relevant excerpt from the target."
                  }
                }
              }
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "recommendedActions": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A recommended action from an agent audit.",
          "required": [
            "kind",
            "title"
          ],
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "run_command",
                "edit_file",
                "review",
                "confirm",
                "block",
                "ignore"
              ]
            },
            "title": {
              "type": "string"
            },
            "command": {
              "type": "string",
              "description": "CLI command to run (for run_command kind)."
            },
            "target": {
              "type": "string",
              "description": "Target file or resource."
            },
            "rationale": {
              "type": "string"
            }
          }
        }
      },
      "metadata": {
        "type": "object",
        "properties": {
          "tool": {
            "type": "string"
          },
          "command": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "generatedAt": {
            "type": "string"
          },
          "adapter": {
            "type": "string"
          },
          "model": {
            "type": "string"
          }
        }
      }
    }
  }
  ```

  </details>

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Validation or configuration error.

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`

  | Property | Type | Required | Description |
  |---|---|---|---|
  | `summary` | `string` | Yes |  |
  | `riskLevel` | `"low" \| "medium" \| "high" \| "critical"` | Yes |  |
  | `findings` | `object[]` | Yes |  |
  | `findings[].id` | `string` | No | Unique finding identifier. |
  | `findings[].severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
  | `findings[].category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
  | `findings[].target` | `string` | No | Target of the finding (command ID, schema path). |
  | `findings[].location` | `string` | No | Location within the target. |
  | `findings[].message` | `string` | Yes |  |
  | `findings[].recommendation` | `string` | No |  |
  | `findings[].confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
  | `findings[].evidence` | `object[]` | No |  |
  | `findings[].evidence[].kind` | `enum(7 values)` | Yes |  |
  | `findings[].evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
  | `findings[].evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
  | `findings[].evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
  | `findings[].details` | `Record<string, any>` | No |  |
  | `recommendedActions` | `object[]` | No |  |
  | `recommendedActions[].kind` | `enum(6 values)` | Yes |  |
  | `recommendedActions[].title` | `string` | Yes |  |
  | `recommendedActions[].command` | `string` | No | CLI command to run (for run_command kind). |
  | `recommendedActions[].target` | `string` | No | Target file or resource. |
  | `recommendedActions[].rationale` | `string` | No |  |
  | `metadata` | `object` | No |  |
  | `metadata.tool` | `string` | No |  |
  | `metadata.command` | `string` | No |  |
  | `metadata.version` | `string` | No |  |
  | `metadata.generatedAt` | `string` | No |  |
  | `metadata.adapter` | `string` | No |  |
  | `metadata.model` | `string` | No |  |

  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
    "required": [
      "summary",
      "riskLevel",
      "findings"
    ],
    "properties": {
      "summary": {
        "type": "string"
      },
      "riskLevel": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high",
          "critical"
        ]
      },
      "findings": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A single finding from an agent audit or analysis.",
          "required": [
            "severity",
            "category",
            "message"
          ],
          "properties": {
            "id": {
              "type": "string",
              "description": "Unique finding identifier."
            },
            "severity": {
              "type": "string",
              "enum": [
                "info",
                "warning",
                "error",
                "critical"
              ]
            },
            "category": {
              "type": "string",
              "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
            },
            "target": {
              "type": "string",
              "description": "Target of the finding (command ID, schema path)."
            },
            "location": {
              "type": "string",
              "description": "Location within the target."
            },
            "message": {
              "type": "string"
            },
            "recommendation": {
              "type": "string"
            },
            "confidence": {
              "type": "number",
              "minimum": 0,
              "maximum": 1,
              "description": "Confidence score (0-1) for LLM-generated findings."
            },
            "evidence": {
              "type": "array",
              "items": {
                "type": "object",
                "description": "Evidence supporting an agent finding.",
                "required": [
                  "kind"
                ],
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "file",
                      "command",
                      "schema",
                      "diff",
                      "stdout",
                      "stderr",
                      "text"
                    ]
                  },
                  "target": {
                    "type": "string",
                    "description": "Target identifier (file path, command ID, schema name)."
                  },
                  "location": {
                    "type": "string",
                    "description": "Location within the target (line number, JSON pointer)."
                  },
                  "excerpt": {
                    "type": "string",
                    "description": "Relevant excerpt from the target."
                  }
                }
              }
            },
            "details": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "recommendedActions": {
        "type": "array",
        "items": {
          "type": "object",
          "description": "A recommended action from an agent audit.",
          "required": [
            "kind",
            "title"
          ],
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "run_command",
                "edit_file",
                "review",
                "confirm",
                "block",
                "ignore"
              ]
            },
            "title": {
              "type": "string"
            },
            "command": {
              "type": "string",
              "description": "CLI command to run (for run_command kind)."
            },
            "target": {
              "type": "string",
              "description": "Target file or resource."
            },
            "rationale": {
              "type": "string"
            }
          }
        }
      },
      "metadata": {
        "type": "object",
        "properties": {
          "tool": {
            "type": "string"
          },
          "command": {
            "type": "string"
          },
          "version": {
            "type": "string"
          },
          "generatedAt": {
            "type": "string"
          },
          "adapter": {
            "type": "string"
          },
          "model": {
            "type": "string"
          }
        }
      }
    }
  }
  ```

  </details>

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  dsl_workflow: workflow-audit
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - network
  sideEffectNote: Network calls to LLM provider when adapter is not mock. Filesystem write only when --output is specified.
  safeDryRunOption: show-prompt
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### explain

Explain command output in human-readable form using LLM.

Reads JSON output from another migraguard command via stdin and generates a human-readable explanation suitable for PR comments, release decisions, or incident communication. Requires agent-contracts-runtime.

**Usage:**

```
migraguard lint --format json | migraguard explain
```
```
migraguard diff --format json | migraguard explain
```
```
migraguard verify --format json | migraguard explain
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--adapter` | -a | No |  | SDK adapter to use. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"json"` | Output format for the explanation report. |
| `--show-prompt` |  | No | `false` | Output the constructed prompt without calling the LLM API. |
| `--log-file` | -l | No |  | Write agent progress log to this file path. |

#### Exit Codes

**Exit 0:** Explanation generated.

- **stdout:** format=`{options.report-format}`


  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Result from explain command. Contains a human-readable explanation of another command's output, suitable for PR comments or release decisions.",
    "allOf": [
      {
        "type": "object",
        "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
        "required": [
          "summary",
          "riskLevel",
          "findings"
        ],
        "properties": {
          "summary": {
            "type": "string"
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ]
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            }
          },
          "metadata": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "command": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "generatedAt": {
                "type": "string"
              },
              "adapter": {
                "type": "string"
              },
              "model": {
                "type": "string"
              }
            }
          }
        }
      },
      {
        "type": "object",
        "required": [
          "explanation"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "description": "One-line summary for quick scanning."
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ],
            "description": "Assessed urgency of the underlying issue."
          },
          "explanation": {
            "type": "string",
            "description": "Multi-paragraph human-readable explanation in Markdown format. Written for non-DBA audiences."
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            },
            "description": "Key points extracted from the command output."
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            },
            "description": "Concrete next steps for the reader."
          },
          "sourceCommand": {
            "type": "string",
            "description": "The command that produced the input (e.g. \"migraguard lint\")."
          }
        }
      }
    ]
  }
  ```

  </details>

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Validation or configuration error.

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`


  <details>
  <summary>JSON Schema</summary>

  ```json
  {
    "type": "object",
    "description": "Result from explain command. Contains a human-readable explanation of another command's output, suitable for PR comments or release decisions.",
    "allOf": [
      {
        "type": "object",
        "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
        "required": [
          "summary",
          "riskLevel",
          "findings"
        ],
        "properties": {
          "summary": {
            "type": "string"
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ]
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            }
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            }
          },
          "metadata": {
            "type": "object",
            "properties": {
              "tool": {
                "type": "string"
              },
              "command": {
                "type": "string"
              },
              "version": {
                "type": "string"
              },
              "generatedAt": {
                "type": "string"
              },
              "adapter": {
                "type": "string"
              },
              "model": {
                "type": "string"
              }
            }
          }
        }
      },
      {
        "type": "object",
        "required": [
          "explanation"
        ],
        "properties": {
          "summary": {
            "type": "string",
            "description": "One-line summary for quick scanning."
          },
          "riskLevel": {
            "type": "string",
            "enum": [
              "low",
              "medium",
              "high",
              "critical"
            ],
            "description": "Assessed urgency of the underlying issue."
          },
          "explanation": {
            "type": "string",
            "description": "Multi-paragraph human-readable explanation in Markdown format. Written for non-DBA audiences."
          },
          "findings": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A single finding from an agent audit or analysis.",
              "required": [
                "severity",
                "category",
                "message"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Unique finding identifier."
                },
                "severity": {
                  "type": "string",
                  "enum": [
                    "info",
                    "warning",
                    "error",
                    "critical"
                  ]
                },
                "category": {
                  "type": "string",
                  "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
                },
                "target": {
                  "type": "string",
                  "description": "Target of the finding (command ID, schema path)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target."
                },
                "message": {
                  "type": "string"
                },
                "recommendation": {
                  "type": "string"
                },
                "confidence": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1,
                  "description": "Confidence score (0-1) for LLM-generated findings."
                },
                "evidence": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "description": "Evidence supporting an agent finding.",
                    "required": [
                      "kind"
                    ],
                    "properties": {
                      "kind": {
                        "type": "string",
                        "enum": [
                          "file",
                          "command",
                          "schema",
                          "diff",
                          "stdout",
                          "stderr",
                          "text"
                        ]
                      },
                      "target": {
                        "type": "string",
                        "description": "Target identifier (file path, command ID, schema name)."
                      },
                      "location": {
                        "type": "string",
                        "description": "Location within the target (line number, JSON pointer)."
                      },
                      "excerpt": {
                        "type": "string",
                        "description": "Relevant excerpt from the target."
                      }
                    }
                  }
                },
                "details": {
                  "type": "object",
                  "additionalProperties": true
                }
              }
            },
            "description": "Key points extracted from the command output."
          },
          "recommendedActions": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "A recommended action from an agent audit.",
              "required": [
                "kind",
                "title"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "run_command",
                    "edit_file",
                    "review",
                    "confirm",
                    "block",
                    "ignore"
                  ]
                },
                "title": {
                  "type": "string"
                },
                "command": {
                  "type": "string",
                  "description": "CLI command to run (for run_command kind)."
                },
                "target": {
                  "type": "string",
                  "description": "Target file or resource."
                },
                "rationale": {
                  "type": "string"
                }
              }
            },
            "description": "Concrete next steps for the reader."
          },
          "sourceCommand": {
            "type": "string",
            "description": "The command that produced the input (e.g. \"migraguard lint\")."
          }
        }
      }
    ]
  }
  ```

  </details>

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  dsl_workflow: command-explanation
  riskLevel: low
  requiresConfirmation: false
  idempotent: true
  sideEffects: 
    - network
  sideEffectNote: Network calls to LLM provider when adapter is not mock. Filesystem write only when --output is specified.
  safeDryRunOption: show-prompt
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### agents

Output the full resolved agent DSL as structured data.

Outputs the complete resolved agent-contracts DSL (agents, tasks, workflows, handoff_types) embedded in this CLI binary. Useful for debugging, external tooling integration, and DSL inspection.

**Usage:**

```
migraguard agents [--format]
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--format` | -F | No | `"yaml"` | Output format. |

#### Exit Codes

**Exit 0:** DSL output successfully.

- **stdout:** format=`text`

**Exit 1:** Failed to load embedded DSL.

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

---

## Schemas

### AgentEvidence

Evidence supporting an agent finding.

Type: `object`

| Property | Type | Required | Description |
|---|---|---|---|
| `kind` | `enum(7 values)` | Yes |  |
| `target` | `string` | No | Target identifier (file path, command ID, schema name). |
| `location` | `string` | No | Location within the target (line number, JSON pointer). |
| `excerpt` | `string` | No | Relevant excerpt from the target. |

<details>
<summary>JSON Schema</summary>

```json
{
  "type": "object",
  "description": "Evidence supporting an agent finding.",
  "required": [
    "kind"
  ],
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "file",
        "command",
        "schema",
        "diff",
        "stdout",
        "stderr",
        "text"
      ]
    },
    "target": {
      "type": "string",
      "description": "Target identifier (file path, command ID, schema name)."
    },
    "location": {
      "type": "string",
      "description": "Location within the target (line number, JSON pointer)."
    },
    "excerpt": {
      "type": "string",
      "description": "Relevant excerpt from the target."
    }
  }
}
```

</details>

### AgentFinding

A single finding from an agent audit or analysis.

Type: `object`

| Property | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | No | Unique finding identifier. |
| `severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
| `category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
| `target` | `string` | No | Target of the finding (command ID, schema path). |
| `location` | `string` | No | Location within the target. |
| `message` | `string` | Yes |  |
| `recommendation` | `string` | No |  |
| `confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
| `evidence` | `object[]` | No |  |
| `evidence[].kind` | `enum(7 values)` | Yes |  |
| `evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
| `evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
| `evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
| `details` | `Record<string, any>` | No |  |

<details>
<summary>JSON Schema</summary>

```json
{
  "type": "object",
  "description": "A single finding from an agent audit or analysis.",
  "required": [
    "severity",
    "category",
    "message"
  ],
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique finding identifier."
    },
    "severity": {
      "type": "string",
      "enum": [
        "info",
        "warning",
        "error",
        "critical"
      ]
    },
    "category": {
      "type": "string",
      "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
    },
    "target": {
      "type": "string",
      "description": "Target of the finding (command ID, schema path)."
    },
    "location": {
      "type": "string",
      "description": "Location within the target."
    },
    "message": {
      "type": "string"
    },
    "recommendation": {
      "type": "string"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "Confidence score (0-1) for LLM-generated findings."
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "Evidence supporting an agent finding.",
        "required": [
          "kind"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "file",
              "command",
              "schema",
              "diff",
              "stdout",
              "stderr",
              "text"
            ]
          },
          "target": {
            "type": "string",
            "description": "Target identifier (file path, command ID, schema name)."
          },
          "location": {
            "type": "string",
            "description": "Location within the target (line number, JSON pointer)."
          },
          "excerpt": {
            "type": "string",
            "description": "Relevant excerpt from the target."
          }
        }
      }
    },
    "details": {
      "type": "object",
      "additionalProperties": true
    }
  }
}
```

</details>

### AgentRecommendedAction

A recommended action from an agent audit.

Type: `object`

| Property | Type | Required | Description |
|---|---|---|---|
| `kind` | `enum(6 values)` | Yes |  |
| `title` | `string` | Yes |  |
| `command` | `string` | No | CLI command to run (for run_command kind). |
| `target` | `string` | No | Target file or resource. |
| `rationale` | `string` | No |  |

<details>
<summary>JSON Schema</summary>

```json
{
  "type": "object",
  "description": "A recommended action from an agent audit.",
  "required": [
    "kind",
    "title"
  ],
  "properties": {
    "kind": {
      "type": "string",
      "enum": [
        "run_command",
        "edit_file",
        "review",
        "confirm",
        "block",
        "ignore"
      ]
    },
    "title": {
      "type": "string"
    },
    "command": {
      "type": "string",
      "description": "CLI command to run (for run_command kind)."
    },
    "target": {
      "type": "string",
      "description": "Target file or resource."
    },
    "rationale": {
      "type": "string"
    }
  }
}
```

</details>

### AgentAuditResult

Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.

Type: `object`

| Property | Type | Required | Description |
|---|---|---|---|
| `summary` | `string` | Yes |  |
| `riskLevel` | `"low" \| "medium" \| "high" \| "critical"` | Yes |  |
| `findings` | `object[]` | Yes |  |
| `findings[].id` | `string` | No | Unique finding identifier. |
| `findings[].severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
| `findings[].category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
| `findings[].target` | `string` | No | Target of the finding (command ID, schema path). |
| `findings[].location` | `string` | No | Location within the target. |
| `findings[].message` | `string` | Yes |  |
| `findings[].recommendation` | `string` | No |  |
| `findings[].confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
| `findings[].evidence` | `object[]` | No |  |
| `findings[].evidence[].kind` | `enum(7 values)` | Yes |  |
| `findings[].evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
| `findings[].evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
| `findings[].evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
| `findings[].details` | `Record<string, any>` | No |  |
| `recommendedActions` | `object[]` | No |  |
| `recommendedActions[].kind` | `enum(6 values)` | Yes |  |
| `recommendedActions[].title` | `string` | Yes |  |
| `recommendedActions[].command` | `string` | No | CLI command to run (for run_command kind). |
| `recommendedActions[].target` | `string` | No | Target file or resource. |
| `recommendedActions[].rationale` | `string` | No |  |
| `metadata` | `object` | No |  |
| `metadata.tool` | `string` | No |  |
| `metadata.command` | `string` | No |  |
| `metadata.version` | `string` | No |  |
| `metadata.generatedAt` | `string` | No |  |
| `metadata.adapter` | `string` | No |  |
| `metadata.model` | `string` | No |  |

<details>
<summary>JSON Schema</summary>

```json
{
  "type": "object",
  "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
  "required": [
    "summary",
    "riskLevel",
    "findings"
  ],
  "properties": {
    "summary": {
      "type": "string"
    },
    "riskLevel": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high",
        "critical"
      ]
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A single finding from an agent audit or analysis.",
        "required": [
          "severity",
          "category",
          "message"
        ],
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique finding identifier."
          },
          "severity": {
            "type": "string",
            "enum": [
              "info",
              "warning",
              "error",
              "critical"
            ]
          },
          "category": {
            "type": "string",
            "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
          },
          "target": {
            "type": "string",
            "description": "Target of the finding (command ID, schema path)."
          },
          "location": {
            "type": "string",
            "description": "Location within the target."
          },
          "message": {
            "type": "string"
          },
          "recommendation": {
            "type": "string"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Confidence score (0-1) for LLM-generated findings."
          },
          "evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "Evidence supporting an agent finding.",
              "required": [
                "kind"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "file",
                    "command",
                    "schema",
                    "diff",
                    "stdout",
                    "stderr",
                    "text"
                  ]
                },
                "target": {
                  "type": "string",
                  "description": "Target identifier (file path, command ID, schema name)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target (line number, JSON pointer)."
                },
                "excerpt": {
                  "type": "string",
                  "description": "Relevant excerpt from the target."
                }
              }
            }
          },
          "details": {
            "type": "object",
            "additionalProperties": true
          }
        }
      }
    },
    "recommendedActions": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A recommended action from an agent audit.",
        "required": [
          "kind",
          "title"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "run_command",
              "edit_file",
              "review",
              "confirm",
              "block",
              "ignore"
            ]
          },
          "title": {
            "type": "string"
          },
          "command": {
            "type": "string",
            "description": "CLI command to run (for run_command kind)."
          },
          "target": {
            "type": "string",
            "description": "Target file or resource."
          },
          "rationale": {
            "type": "string"
          }
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string"
        },
        "command": {
          "type": "string"
        },
        "version": {
          "type": "string"
        },
        "generatedAt": {
          "type": "string"
        },
        "adapter": {
          "type": "string"
        },
        "model": {
          "type": "string"
        }
      }
    }
  }
}
```

</details>

### MigrationAuditResult

Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.

Type: `object`

| Property | Type | Required | Description |
|---|---|---|---|
| `summary` | `string` | Yes |  |
| `riskLevel` | `"low" \| "medium" \| "high" \| "critical"` | Yes |  |
| `findings` | `object[]` | Yes |  |
| `findings[].id` | `string` | No | Unique finding identifier. |
| `findings[].severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
| `findings[].category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
| `findings[].target` | `string` | No | Target of the finding (command ID, schema path). |
| `findings[].location` | `string` | No | Location within the target. |
| `findings[].message` | `string` | Yes |  |
| `findings[].recommendation` | `string` | No |  |
| `findings[].confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
| `findings[].evidence` | `object[]` | No |  |
| `findings[].evidence[].kind` | `enum(7 values)` | Yes |  |
| `findings[].evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
| `findings[].evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
| `findings[].evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
| `findings[].details` | `Record<string, any>` | No |  |
| `recommendedActions` | `object[]` | No |  |
| `recommendedActions[].kind` | `enum(6 values)` | Yes |  |
| `recommendedActions[].title` | `string` | Yes |  |
| `recommendedActions[].command` | `string` | No | CLI command to run (for run_command kind). |
| `recommendedActions[].target` | `string` | No | Target file or resource. |
| `recommendedActions[].rationale` | `string` | No |  |
| `metadata` | `object` | No |  |
| `metadata.tool` | `string` | No |  |
| `metadata.command` | `string` | No |  |
| `metadata.version` | `string` | No |  |
| `metadata.generatedAt` | `string` | No |  |
| `metadata.adapter` | `string` | No |  |
| `metadata.model` | `string` | No |  |

<details>
<summary>JSON Schema</summary>

```json
{
  "type": "object",
  "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
  "required": [
    "summary",
    "riskLevel",
    "findings"
  ],
  "properties": {
    "summary": {
      "type": "string"
    },
    "riskLevel": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high",
        "critical"
      ]
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A single finding from an agent audit or analysis.",
        "required": [
          "severity",
          "category",
          "message"
        ],
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique finding identifier."
          },
          "severity": {
            "type": "string",
            "enum": [
              "info",
              "warning",
              "error",
              "critical"
            ]
          },
          "category": {
            "type": "string",
            "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
          },
          "target": {
            "type": "string",
            "description": "Target of the finding (command ID, schema path)."
          },
          "location": {
            "type": "string",
            "description": "Location within the target."
          },
          "message": {
            "type": "string"
          },
          "recommendation": {
            "type": "string"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Confidence score (0-1) for LLM-generated findings."
          },
          "evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "Evidence supporting an agent finding.",
              "required": [
                "kind"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "file",
                    "command",
                    "schema",
                    "diff",
                    "stdout",
                    "stderr",
                    "text"
                  ]
                },
                "target": {
                  "type": "string",
                  "description": "Target identifier (file path, command ID, schema name)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target (line number, JSON pointer)."
                },
                "excerpt": {
                  "type": "string",
                  "description": "Relevant excerpt from the target."
                }
              }
            }
          },
          "details": {
            "type": "object",
            "additionalProperties": true
          }
        }
      }
    },
    "recommendedActions": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A recommended action from an agent audit.",
        "required": [
          "kind",
          "title"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "run_command",
              "edit_file",
              "review",
              "confirm",
              "block",
              "ignore"
            ]
          },
          "title": {
            "type": "string"
          },
          "command": {
            "type": "string",
            "description": "CLI command to run (for run_command kind)."
          },
          "target": {
            "type": "string",
            "description": "Target file or resource."
          },
          "rationale": {
            "type": "string"
          }
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string"
        },
        "command": {
          "type": "string"
        },
        "version": {
          "type": "string"
        },
        "generatedAt": {
          "type": "string"
        },
        "adapter": {
          "type": "string"
        },
        "model": {
          "type": "string"
        }
      }
    }
  }
}
```

</details>

### ExpandContractProposal

Result from propose-expand-contract command. Contains the proposed phased migration group with SQL for each phase.

Type: `object`


### ImplementMigrationResult

Result from implement command. Contains generated migration SQL files following safe DDL patterns, predicted lint findings, and recommended workflow steps.

Type: `object`


### WorkflowAuditResult

Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.

Type: `object`

| Property | Type | Required | Description |
|---|---|---|---|
| `summary` | `string` | Yes |  |
| `riskLevel` | `"low" \| "medium" \| "high" \| "critical"` | Yes |  |
| `findings` | `object[]` | Yes |  |
| `findings[].id` | `string` | No | Unique finding identifier. |
| `findings[].severity` | `"info" \| "warning" \| "error" \| "critical"` | Yes |  |
| `findings[].category` | `string` | Yes | Finding category (e.g. missing-policy, inconsistent-risk). |
| `findings[].target` | `string` | No | Target of the finding (command ID, schema path). |
| `findings[].location` | `string` | No | Location within the target. |
| `findings[].message` | `string` | Yes |  |
| `findings[].recommendation` | `string` | No |  |
| `findings[].confidence` | `number (min: 0, max: 1)` | No | Confidence score (0-1) for LLM-generated findings. |
| `findings[].evidence` | `object[]` | No |  |
| `findings[].evidence[].kind` | `enum(7 values)` | Yes |  |
| `findings[].evidence[].target` | `string` | No | Target identifier (file path, command ID, schema name). |
| `findings[].evidence[].location` | `string` | No | Location within the target (line number, JSON pointer). |
| `findings[].evidence[].excerpt` | `string` | No | Relevant excerpt from the target. |
| `findings[].details` | `Record<string, any>` | No |  |
| `recommendedActions` | `object[]` | No |  |
| `recommendedActions[].kind` | `enum(6 values)` | Yes |  |
| `recommendedActions[].title` | `string` | Yes |  |
| `recommendedActions[].command` | `string` | No | CLI command to run (for run_command kind). |
| `recommendedActions[].target` | `string` | No | Target file or resource. |
| `recommendedActions[].rationale` | `string` | No |  |
| `metadata` | `object` | No |  |
| `metadata.tool` | `string` | No |  |
| `metadata.command` | `string` | No |  |
| `metadata.version` | `string` | No |  |
| `metadata.generatedAt` | `string` | No |  |
| `metadata.adapter` | `string` | No |  |
| `metadata.model` | `string` | No |  |

<details>
<summary>JSON Schema</summary>

```json
{
  "type": "object",
  "description": "Top-level result from an agent audit. Canonical schema for agent interoperability across toolchains.",
  "required": [
    "summary",
    "riskLevel",
    "findings"
  ],
  "properties": {
    "summary": {
      "type": "string"
    },
    "riskLevel": {
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high",
        "critical"
      ]
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A single finding from an agent audit or analysis.",
        "required": [
          "severity",
          "category",
          "message"
        ],
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique finding identifier."
          },
          "severity": {
            "type": "string",
            "enum": [
              "info",
              "warning",
              "error",
              "critical"
            ]
          },
          "category": {
            "type": "string",
            "description": "Finding category (e.g. missing-policy, inconsistent-risk)."
          },
          "target": {
            "type": "string",
            "description": "Target of the finding (command ID, schema path)."
          },
          "location": {
            "type": "string",
            "description": "Location within the target."
          },
          "message": {
            "type": "string"
          },
          "recommendation": {
            "type": "string"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Confidence score (0-1) for LLM-generated findings."
          },
          "evidence": {
            "type": "array",
            "items": {
              "type": "object",
              "description": "Evidence supporting an agent finding.",
              "required": [
                "kind"
              ],
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "file",
                    "command",
                    "schema",
                    "diff",
                    "stdout",
                    "stderr",
                    "text"
                  ]
                },
                "target": {
                  "type": "string",
                  "description": "Target identifier (file path, command ID, schema name)."
                },
                "location": {
                  "type": "string",
                  "description": "Location within the target (line number, JSON pointer)."
                },
                "excerpt": {
                  "type": "string",
                  "description": "Relevant excerpt from the target."
                }
              }
            }
          },
          "details": {
            "type": "object",
            "additionalProperties": true
          }
        }
      }
    },
    "recommendedActions": {
      "type": "array",
      "items": {
        "type": "object",
        "description": "A recommended action from an agent audit.",
        "required": [
          "kind",
          "title"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "run_command",
              "edit_file",
              "review",
              "confirm",
              "block",
              "ignore"
            ]
          },
          "title": {
            "type": "string"
          },
          "command": {
            "type": "string",
            "description": "CLI command to run (for run_command kind)."
          },
          "target": {
            "type": "string",
            "description": "Target file or resource."
          },
          "rationale": {
            "type": "string"
          }
        }
      }
    },
    "metadata": {
      "type": "object",
      "properties": {
        "tool": {
          "type": "string"
        },
        "command": {
          "type": "string"
        },
        "version": {
          "type": "string"
        },
        "generatedAt": {
          "type": "string"
        },
        "adapter": {
          "type": "string"
        },
        "model": {
          "type": "string"
        }
      }
    }
  }
}
```

</details>

### ExplainResult

Result from explain command. Contains a human-readable explanation of another command's output, suitable for PR comments or release decisions.

Type: `object`

