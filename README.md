# migraguard

An incident-prevention migration tool for PostgreSQL. Enforces safe operational policies via CI gates and DB state tracking, so that common migration accidents — accidental edits to past files, hotfix reversions, unresolved failures, mid-sequence insertions — are structurally impossible.

Execution is deliberately simple: plain SQL files executed via `psql`. migraguard focuses on **what to forbid**, not on providing a rich execution engine.

## Guarantees

migraguard guarantees the following:

- **Changes to non-editable nodes are detected and rejected in CI** — Only the tail file (linear model) or leaf nodes (DAG model) are editable. `check` returns an error if any other file has been modified
- **Unintended regression is detected and rejected** — If a hotfixed file reverts to an old checksum, `apply` immediately returns an error
- **`apply` uses advisory lock for mutual exclusion** — Prevents concurrent application to the same environment, eliminating race conditions
- **`apply --verify` performs drift detection, application, and dump update as a single operation** — Detects divergence between expected schema and actual DB before applying, then auto-updates the dump after successful application
- **Failure state is recorded in the DB and blocks further progress** — Subsequent applications are blocked as long as a `failed` file remains unresolved. Requires explicit human judgment via `resolve`

## Quick Start

```bash
# Install
npm install --save-dev migraguard

# Create a new migration → edit the generated file → apply to local DB
npx migraguard new create_users_table
# → Created: db/migrations/20260301_120000__create_users_table.sql
# Edit the file shown above, then:
npx migraguard apply

# Before release: squash → lint + check → update dump
npx migraguard squash
npx migraguard lint && npx migraguard check
npx migraguard dump

# In PRs, CI runs lint + check (+ optionally verify)
# Squash files into one before merging to release branch
```

## Design Philosophy

- **Plain SQL**: Migrations are managed as SQL files executable via `psql -f`. No ORM or migration-framework-specific DSL; transaction boundaries are explicit in SQL
- **Forward-only**: Modifying applied migrations is prohibited by default; changes always build forward. Only the latest migration file may be overwritten and re-applied, assuming idempotency is maintained
- **One release = one file**: Migration files with dependencies are squashed into a single file before release. One file = one release unit, simplifying error recovery and re-application. In DAG mode, independent DDL can be released individually, and `squash` auto-groups by dependency chain
- **Parallel releases via dependency tree**: DDL dependencies are analyzed to build a DAG, enabling concurrent work and parallel releases for independent changes. Relaxes the constraints of the linear model for large-scale systems
- **Shift verification left**: Squawk linting, checksum-based tamper detection, and schema dump diffs run in CI (at the PR stage), eliminating risks before reaching production
- **Minimal footprint**: Avoids tool-specific lock-in and black boxes. The entire runtime depends on four external tools, each with a clear responsibility:
  - `psql` — executes migration SQL files directly
  - `pg_dump` — produces normalized schema dumps for drift detection
  - [Squawk](https://squawkhq.com/) — lints SQL for safety and idempotency (optional)
  - [libpg-query](https://github.com/pganalyze/libpg-query) — parses DDL into AST for dependency analysis (DAG model)

## Two-Layer State Management

migraguard separates file integrity and application state.

| Layer | Location | Role |
|-------|----------|------|
| **metadata.json** (repository) | `db/.migraguard/metadata.json` | List of migration files and checksums. Used for integrity checks in CI. Environment-independent |
| **schema_migrations table** (per DB) | Each environment's PostgreSQL | Records applied files and checksums for that environment. Used by `apply` to determine pending migrations |

metadata.json represents "which files should exist"; schema_migrations represents "what has been applied to which environment". This separation enables correct staged rollout from a single repository to multiple environments (staging, production).

### Checksum Normalization

Checksums are computed on **normalized SQL**, not on the raw file content. Before hashing (SHA-256), the following normalization is applied:

- SQL comments are stripped (`-- ...` line comments and `/* ... */` block comments, including nested)
- Whitespace is collapsed (multiple spaces, tabs, newlines → single space) and trimmed
- String literals are preserved as-is (`'...'`, `"..."`, `$$...$$`, `$tag$...$tag$`, `E'...'`)

This means that adding or modifying comments, adjusting indentation, or changing blank lines does not change the checksum. Only changes to the actual SQL statements are detected. `-- migraguard:depends-on` directives are also comments and do not affect the checksum; dependency analysis reads the raw file independently.

## Commands

### Migration Management

| Command | Description |
|---------|-------------|
| `migraguard new <name>` | Generate a new migration SQL file with a local-timezone timestamp (or serial number) |
| `migraguard squash` | Merge multiple pending migration files into one. Run before release |
| `migraguard apply` | Execute pending migrations sequentially via `psql`. Uses the `schema_migrations` table to determine applied state |
| `migraguard resolve <file>` | Explicitly mark a failed migration as skipped. Run after a human confirms the issue is covered by a subsequent forward migration |
| `migraguard status` | Display a list of migrations with their status: applied, pending, failed, or skipped |
| `migraguard editable` | List currently editable migration files. Tail file in linear model, leaf nodes in DAG model. When connected to DB, also shows failed files eligible for retry |

### Integrity Checks

| Command | Description |
|---------|-------------|
| `migraguard check` | Compare checksums (computed on normalized SQL) between metadata.json and actual files. Errors on changes to any file except the latest. No DB connection required |
| `migraguard lint` | SQL lint using Squawk. Detects rule violations related to idempotency and safety |
| `migraguard verify` | Dynamically verify idempotency of each migration using a shadow DB. Dumps and restores the existing DB, applies pending migrations twice, and confirms no errors and schema invariance |
| `migraguard verify --all` | Verify idempotency of all migrations from scratch on an empty shadow DB |

### Schema Management

| Command | Description |
|---------|-------------|
| `migraguard dump` | Run `pg_dump --schema-only` and output normalized schema. Saved in a diff-friendly format |
| `migraguard diff` | Display differences between the current DB schema and the saved schema dump |

### Dependency Analysis / DAG Model

| Command | Description |
|---------|-------------|
| `migraguard deps` | Display inter-migration dependencies in tree format. ◆=editable (leaf node), ◇=locked (non-leaf node) |
| `migraguard deps --html <path>` | Generate an HTML dependency graph using GitGraph.js |

![Migration Dependency Graph](assets/deps-graph.png)

## Directory Structure

```
project-root/
├── migraguard.config.json          # Configuration file
├── db/
│   ├── migrations/            # Migration SQL files (default)
│   │   ├── 20260301_120000__create_users_table.sql
│   │   ├── 20260302_093000__add_email_index.sql
│   │   └── ...
│   ├── schema.sql             # Normalized schema dump (generated)
│   └── .migraguard/
│       └── metadata.json      # File list + checksums (no application state)
├── services/                  # For monorepo setups
│   ├── auth/migrations/       # Additional search paths via migrationsDirs
│   │   └── ...
│   └── billing/migrations/
│       └── ...
└── ...
```

When multiple search paths are specified via `migrationsDirs`, all directories are scanned for migration files and sorted by timestamp (or serial number). `new` / `squash` write to the first directory in the array.

### schema_migrations Table (created in each environment's DB)

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          BIGSERIAL    PRIMARY KEY,
    file_name   VARCHAR(256) NOT NULL,
    checksum    VARCHAR(64)  NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'applied',  -- applied / failed / skipped
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ                               -- resolution timestamp for skipped
);
```

Automatically created on the first run of `migraguard apply`.

**History policy: fully INSERT-only — why no UPDATE**

The PK is `BIGSERIAL` (auto-increment), so a new record is INSERTed every time, even for the same file and checksum. **No UPDATEs are ever performed.** This is not a simplification; it is a deliberate design choice. UPDATE-based designs lose the history needed for regression detection (matching the current checksum against all past checksums). INSERT-only also provides a complete audit log of every application attempt, including failures.

- Re-application of the same file (e.g., hotfix with changed checksum) → INSERT a new record with the new checksum
- Re-execution with the same checksum (idempotent re-apply) → INSERT a new record with the same checksum (different `applied_at`)
- `failed` → re-execution after fix → The `failed` record remains; a new `applied` record is INSERTed
- `resolve` → The `failed` record remains; a `skipped` record with the same checksum is INSERTed

A file's "current state" is determined by the `status` of its latest record (maximum `applied_at`). Past records remain as an audit log.

Status meanings:

| status | Meaning |
|--------|---------|
| `applied` | Successfully applied |
| `failed` | Application attempted but failed with error. Unresolved |
| `skipped` | Explicitly skipped via `migraguard resolve`. Human judgment that a subsequent forward migration covers the fix |

### Regression Detection (unintended revert of hotfixed migrations)

**Accident being prevented**: A migration file that has been hotfixed reverts to an old version due to git revert, branch switching, merge mistakes, etc., causing the pre-fix DDL to be re-applied to production.

During apply, if the file's current checksum **matches a past record's checksum (not the latest)**, it is treated as an unintended revert and raises an error.

```
Example:
  schema_migrations contains the following history:
    (S1.sql, checksum_v1, applied)   ← initial application
    (S1.sql, checksum_v2, applied)   ← re-applied after hotfix

  The file's checksum has reverted to checksum_v1
    → latest record is checksum_v2 → mismatch → matches past checksum_v1
    → error: regression detected
```

## Configuration (migraguard.config.json)

```json
{
  "migrationsDirs": ["db/migrations"],
  "schemaFile": "db/schema.sql",
  "metadataFile": "db/.migraguard/metadata.json",
  "naming": {
    "pattern": "{timestamp}__{description}.sql",
    "timestamp": "YYYYMMDD_HHMMSS",
    "prefix": "",
    "sortKey": "timestamp"
  },
  "connection": {
    "host": "localhost",
    "port": 5432,
    "database": "myapp_dev",
    "user": "postgres"
  },
  "dump": {
    "normalize": true,
    "excludeOwners": true,
    "excludePrivileges": true
  },
  "lint": {
    "squawk": true
  }
}
```

### Naming Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `pattern` | `{timestamp}__{description}.sql` | Filename template. Supports `{timestamp}`, `{prefix}`, `{description}` |
| `timestamp` | `YYYYMMDD_HHMMSS` | Timestamp format (local timezone). Use `NNNN` (N-only format) for serial number mode (auto-increments from the max existing number + 1) |
| `prefix` | `""` | Fixed prefix applied to all files. Used for category or service name identification |
| `sortKey` | `timestamp` | Key used to determine file sort order. `timestamp` (ascending by timestamp portion) is standard |

**Customization examples**:

```json
// Prefix by microservice
{
  "naming": {
    "pattern": "{prefix}_{timestamp}__{description}.sql",
    "prefix": "auth"
  }
}
// → auth_20260301_120000__add_users_table.sql

// Serial number based
{
  "naming": {
    "pattern": "{prefix}_{timestamp}__{description}.sql",
    "timestamp": "NNNN",
    "prefix": "billing"
  }
}
// → billing_0001__create_invoices_table.sql

// Category + timestamp
{
  "naming": {
    "pattern": "{prefix}_{timestamp}__{description}.sql",
    "prefix": "order-service"
  }
}
// → order-service_20260301_120000__add_shipping_status.sql
```

`migraguard new` generates filenames according to this configuration. `migraguard check` / `apply` extract the timestamp portion based on the pattern and determine sort order.

`migrationsDirs` accepts multiple search paths. Used when migration directories are split per microservice in a monorepo. For backward compatibility, `migrationsDir` (singular) is also accepted. `new` / `squash` write to the first directory in the array.

```json
// Multiple directory setup for monorepo
{
  "migrationsDirs": [
    "db/migrations",
    "services/auth/migrations",
    "services/billing/migrations"
  ]
}
```

`connection` can be overridden via environment variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`).

## Migration File Conventions

### File Naming

Default pattern:

```
YYYYMMDD_HHMMSS__<description>.sql
```

With custom `naming` configuration:

```
<prefix>_YYYYMMDD_HHMMSS__<description>.sql
```

- Timestamps use local timezone (`naming.timestamp` to change format; `NNNN` for serial number mode)
- Description uses alphanumeric characters and underscores only
- Prefix operation type: `create_`, `add_`, `alter_`, `drop_`, `backfill_`, `create_index_`
- Prefix is a category/microservice identifier (configured via `naming.prefix`)

### Idempotency

Migration SQL must be idempotent. It must complete safely when re-executed after a partial failure.

```sql
-- Use IF NOT EXISTS / IF EXISTS
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);

-- Use WHERE clauses for idempotent backfill conditions
UPDATE users SET status = 'active' WHERE status IS NULL;
```

### Safe DDL Templates (PostgreSQL)

Since migraguard assumes plain SQL, understanding safe DDL patterns is essential.

**Setting lock timeout**:

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

RESET lock_timeout;
RESET statement_timeout;
```

Without `lock_timeout`, `ALTER TABLE` can block for extended periods waiting for a table lock, stalling subsequent queries. Always set this in production.

**`CREATE INDEX CONCURRENTLY` must run outside a transaction**:

```sql
-- CONCURRENTLY cannot be used inside a transaction
-- Ensure no BEGIN at the start of the file
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
```

A regular `CREATE INDEX` acquires an exclusive lock on the entire table. `CONCURRENTLY` avoids blocking writes but cannot run inside a transaction. Since `psql -v ON_ERROR_STOP=1 -f` executes files directly, do not include `BEGIN` / `COMMIT`.

**Batch large data backfills for resumability**:

```sql
-- A single UPDATE on all rows causes prolonged locks
-- Use batching or WHERE clauses for idempotent, resumable execution
UPDATE users SET status = 'active'
WHERE status IS NULL
  AND id BETWEEN 1 AND 100000;
```

Large-row UPDATEs are problematic for both lock duration and WAL write volume. Either batch in the application layer or segment ranges within the migration.

## Squash Flow

`migraguard squash` merges multiple migration files created during development into a single file. Run before merging to the release branch.

```bash
npx migraguard squash
```

### Linear Model Behavior

1. Read metadata.json
2. Identify new files in `migrationsDir` not recorded in metadata.json
3. If there are 2 or more new files, concatenate them in timestamp order into a single file
4. The merged filename uses the latest timestamp; descriptions are combined
5. Delete original files and update metadata.json

```
Before squash:
  20260228_120000__add_user_email.sql     (new)
  20260301_093000__add_email_index.sql    (new)

After squash:
  20260301_093000__add_user_email_and_email_index.sql  (merged into 1 file)
```

`migraguard check` returns an error if there are 2 or more new files (not recorded in metadata.json). This enforces running squash before push. **This constraint applies to the linear model only.** In DAG mode, independent groups (no mutual dependencies) are allowed as separate new files; squash is enforced only within each dependency chain.

### DAG Model Behavior

In DAG mode, new files are automatically split into connected components (groups) based on dependencies, and squash is performed per group. Independent DDL (no mutual dependencies) remains as individual files.

```
Before squash:
  20260308_100000__create_follows.sql         (new — depends on users)
  20260308_110000__add_follow_index.sql       (new — depends on follows)
  20260309_100000__create_notifications.sql   (new — depends on users, independent of follows)

After squash:
  20260308_110000__create_follows_and_add_follow_index.sql  (dependency chain merged)
  20260309_100000__create_notifications.sql                 (independent — unchanged)
```

Within each group, files are concatenated in ascending timestamp order, guaranteeing that dependencies precede dependents.

### Why One Release = One File

**Premise**: migraguard enforces tamper detection via the invariant that "only editable nodes (tail in linear, leaf in DAG) can be modified." Squash is the mechanism that makes this invariant practical.

**Failure scenario when this is not followed**:

```
20260228__add_col.sql and 20260301__add_index.sql released while both pending
  → 20260228 fails with error
  → Want to fix it, but 20260301 is the latest file so check blocks changes to 20260228
  → 20260301 depends on 20260228, requiring fixes to both
  → Must use resolve + forward migration as a workaround, increasing incident risk
```

**With a single file it's simple**:
- Squashed file fails → fix that file → re-apply
- Conforms to the editable node rule; safe to re-execute due to idempotency

**Alternative**: In DAG mode, independent DDL (changes with no mutual dependencies) can be released as individual files. Squash is only enforced for files within the same dependency chain. For teams needing parallel work at scale, adopting the DAG model is recommended.

## Apply Flow

`migraguard apply` references the target DB's `schema_migrations` table to determine and execute pending migrations.

1. Fetch all records from the DB's `schema_migrations` table
2. Sort files in `migrationsDir` by timestamp
3. For each file, reference **the latest record for that filename** (maximum `applied_at`):
   - No record → new file → execute via `psql -v ON_ERROR_STOP=1 -f <file>`
   - Latest record status=`applied` + checksum match → skip
   - Latest record status=`applied` + checksum mismatch:
     - Matches a past record's checksum → immediate error (regression detection)
     - Latest file (tail) → re-apply (assumes idempotency)
     - Not the latest → immediate error (tamper detection)
   - Latest record status=`skipped` → skip (`resolve`d)
   - Latest record status=`failed`:
     - Latest file (tail) → retry (assumes fix has been applied)
     - Not the latest → immediate error (unresolved failure; `migraguard resolve` or squash required)
4. **INSERT a new record** into `schema_migrations` based on the result:
   - Success → status=`applied`
   - Failure → status=`failed`; subsequent files are not executed
5. The latest file (tail) is allowed to be re-applied even if modified (for iterative development and production hotfix scenarios)

metadata.json is not referenced in this flow. apply trusts only the DB state.

### History Accumulation Example

```
schema_migrations table state transitions:

── Initial application ──
(S1.sql, checksum_v1, applied, 2026-03-01 12:00)

── S1 modified and re-applied (hotfix) ──
(S1.sql, checksum_v1, applied, 2026-03-01 12:00)   ← past record (retained)
(S1.sql, checksum_v2, applied, 2026-03-01 15:00)   ← latest record

── Accidentally reverted to checksum_v1 ──
→ matches past record checksum_v1 → regression error
```

### Failure Recovery

```
Case 1: Latest file S1 fails (no files after S1)
  → Fix S1 and re-run apply (S1 is latest so modification is allowed, failed → retry)
  → A new applied record with the new checksum is added

Case 2: S2 was added after S1 failed (S1 is no longer the latest)
  → apply stops with error "S1 is unresolved"
  → Option A: migraguard resolve S1 → marks S1 as skipped; S2 covers the fix
  → Option B: squash S1 + S2 into a single file
              (S1's failed record becomes orphaned in the DB, but apply operates on files so this is harmless)
```

### Resolve Behavior

```bash
npx migraguard resolve 20260301_093000__add_user_email.sql
```

- INSERTs a status=`skipped` record into `schema_migrations` with the same checksum as the file's latest failed record
- Records the current time in `resolved_at`
- Errors if the file's latest record is not `failed`
- An explicit operation that requires human confirmation that a subsequent forward migration covers the fix

## Verification

migraguard provides two distinct verification mechanisms. They serve different purposes and should not be confused.

### `apply --verify` — Schema Drift Gate (pre/post apply)

**Purpose**: Ensure the DB has not drifted from the expected schema before applying migrations, and update the recorded schema after successful application.

1. Dump the current DB schema and compare with the saved `schema.sql`
2. If they **differ** → error: schema drift detected, apply is blocked
3. If they match → proceed with apply
4. After apply completes, generate a new schema dump and update `schema.sql`

```bash
migraguard apply --verify
```

Use this in CI pipelines (e.g., on merge to release branches) to catch unauthorized manual DDL changes before applying migrations.

### `verify` — Dynamic Idempotency Proof (shadow DB)

**Purpose**: Prove that migrations are idempotent by actually executing them twice on a disposable shadow DB and confirming no errors and no schema change.

- `verify` (incremental): Dumps and restores the current DB to a shadow, then applies only pending migrations twice
- `verify --all`: Creates an empty shadow DB and applies all migrations from scratch twice

```bash
migraguard verify          # incremental: verify pending only
migraguard verify --all    # full: verify all from scratch
```

This is stronger than lint rules or conventions — it dynamically proves that every migration can be safely re-executed. Use in CI or before releases as a final safety net.

## Check Flow (CI-oriented)

`migraguard check` is a file integrity check designed for CI environments. No DB connection required.

1. Read metadata.json
2. Compute checksums of all files in `migrationsDir`
3. Check the following:
   - Do checksums of files recorded in metadata.json match actual files (except the latest)?
   - Have any files other than the latest been modified?
   - Have new files been inserted mid-sequence (added at a position other than the end in timestamp order)?
   - **Are there 2 or more new files (not recorded in metadata.json)?** (linear model only; DAG mode allows multiple independent groups)
4. If any violation is found, exit with code 1 and output the diff details

### Limitations of check and Operational Policy

check does not connect to the DB, so it cannot determine "what has been applied to which environment." apply detects `failed` state on the DB side and stops with an error, but ideally this situation should be avoided entirely. The following cases are prevented by operational policy.

**Problematic scenario**:

```
1. Create S1 → apply to dev (S1 applied)
2. Add S2 before applying S1 to pro
3. Apply S1 to pro → error → recorded as failed in schema_migrations
4. Want to fix S1, but S2 is now the latest so check blocks modification
5. apply also stops with "S1 is unresolved" error
6. Recovery: migraguard resolve S1 → apply S2 (S2 covers S1's fix)
```

Recovery is possible, but whether S2 correctly covers S1's intent requires human judgment. An operational policy is established to avoid this situation.

**Operational policy: Do not add the next migration until the current release is deployed to all environments**

```
Create S1 → apply to dev → apply to pro → all environments complete
                                                │
                                    S2 can be added only here
```

If S2 is added in violation of this policy and S1 subsequently needs modification, do not modify S1 directly. Instead, **create a new forward migration (S3) containing the corrective SQL**. Leave S1 unchanged; S3 compensates for S1's issue.

### Responsibilities of check vs apply

| | check | apply |
|---|---|---|
| Data source | metadata.json (repository) | schema_migrations table (DB) |
| DB connection | Not required | Required |
| Purpose | Pre-verification in CI (PR check) | Actual application to environments |
| Detection scope | File tampering, unauthorized additions, multiple new files | Identifying and applying pending files |

## Release Flow

Typical flow when release branches are `db_dev` (staging) and `db_pro` (production):

```
Development on feature branch:
  migraguard new add_user_email      → 20260228_120000__add_user_email.sql
  migraguard new add_email_index     → 20260301_093000__add_email_index.sql
  (apply individually for local verification)
         │
         ▼
Release preparation:
  migraguard squash                  → merge into 1 file
  migraguard lint                    → lint check
  migraguard check                   → integrity check
  git commit
         │
         ▼
Merge to db_dev → CI runs apply → applied to staging
         │
         │  On error: fix file → re-apply (latest = only file, so modification allowed)
         │
         ▼
Merge to db_pro → CI runs apply → applied to production
         │
         │  On error: fix the same file → re-apply
         │  (staging safely re-applies the fixed version due to idempotency)
         │
         ▼
       All environments complete ← next migration can be added only here
```

**Important**: Do not add the next migration file until the current release (1 file) is deployed to all environments. This policy ensures the latest file can always be modified and re-applied.

### Environment State Transitions

```
           metadata.json     db_dev schema_migrations   db_pro schema_migrations
           (repository)       (staging DB)               (production DB)

After squash [A, B, S]       [A, B]                     [A, B]
After dev    [A, B, S]       [A, B, S ✓]                [A, B]
After pro    [A, B, S]       [A, B, S ✓]                [A, B, S ✓]
                                                           ↑ next release unlocked

A, B = previously applied files
S = file generated by squash
```

metadata.json holds only the file list; each DB manages which files have been applied. The same metadata.json correctly supports staged rollout to multiple environments.

### Recovery When Policy Is Violated

If the next file was added before all-environment deployment and a past file needs modification:

1. Do not modify past files directly (check will block)
2. Create a new forward migration containing corrective SQL for the past file's issue
3. Squash the current new files and the forward migration into one

## GitHub Actions Integration

### PR Check (example)

```yaml
name: DB Migration Check
on:
  pull_request:
    paths:
      - 'db/**'

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install migraguard
        run: npm ci

      - name: Lint migrations
        run: npx migraguard lint

      - name: Check metadata integrity
        run: npx migraguard check

      - name: Verify schema dump
        run: |
          # Compare dump after applying all migrations on shadow DB
          npx migraguard dump --connection-string "$SHADOW_DB_URL" > /tmp/actual_schema.sql
          diff db/schema.sql /tmp/actual_schema.sql
```

### Automatic Migration Execution (example)

```yaml
name: Apply Migrations
on:
  push:
    branches: [db_dev]
    paths:
      - 'db/migrations/**'

jobs:
  apply:
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install migraguard
        run: npm ci

      - name: Check integrity
        run: npx migraguard check

      - name: Apply with verification
        run: npx migraguard apply --verify
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}
```

## Local Development Flow

```bash
# 1. Create a new migration file
npx migraguard new add_user_email

# 2. Edit the generated SQL file
vim db/migrations/20260301_120000__add_user_email.sql

# 3. Apply to local DB (latest file can be re-applied any number of times)
npx migraguard apply

# 4. Create and apply additional files as needed
npx migraguard new add_email_index
vim db/migrations/20260302_093000__add_email_index.sql
npx migraguard apply

# 5. Squash into a single file before release
npx migraguard squash

# 6. Lint + integrity check
npx migraguard lint
npx migraguard check

# 7. Update schema dump
npx migraguard dump

# 8. Commit
git add db/
git commit -m "add user email column and index"
```

## Dependency Tree Model (Extension)

The linear ordering model has the constraint that "only the tail file can be modified and re-applied." The dependency tree model relaxes this constraint, enabling concurrent work on independent changes.

### When to Use DAG

Start with the linear model. Switch to DAG when any of the following apply:

- **Multiple teams modify independent tables concurrently** and serializing releases creates bottlenecks
- **Environment deploy lead time is long** (e.g., staging → production takes days), making the "deploy to all environments before next migration" policy impractical
- **You want to localize failure blast radius** — in linear mode, one failure blocks all subsequent files; in DAG mode, only dependents are blocked
- **Independent schema changes should be releasable independently** (e.g., a new feature table should not wait for an unrelated index migration)

### Linear Model vs Dependency Tree Model

```
Linear model:
  A → B → C → D
                ↑ Only D can be modified. Error in C blocks D's release

Dependency tree model:
          A (create users table)
         / \
        B   C (B: add column to users, C: create orders table)
        |     \
        D      E (D: add index to users, E: add index to orders)

  D and E are independent → both can be modified and re-applied
  Error in D does not block E's release
```

### Dependency Analysis Method

Each migration SQL is parsed into an AST using a PostgreSQL parser (`libpg_query`) to extract object creation/reference relationships and build a DAG (directed acyclic graph).

```
Information extracted from SQL statements:

  CREATE TABLE users (...)
    → creates: users

  ALTER TABLE users ADD COLUMN email VARCHAR(256)
    → depends: users  → creates: users.email

  CREATE INDEX CONCURRENTLY ON users (email)
    → depends: users, users.email

  CREATE TABLE orders (user_id INT REFERENCES users(id))
    → depends: users  → creates: orders
```

Extractable DDL and dependency types:

| DDL | Creates | Depends On |
|-----|---------|------------|
| `CREATE TABLE` | table | none (referenced tables if REFERENCES present) |
| `ALTER TABLE ADD COLUMN` | column | table |
| `ALTER TABLE ADD CONSTRAINT` | constraint | table, columns, referenced tables |
| `CREATE INDEX` | index | table, columns |
| `CREATE VIEW` | view | referenced tables |
| `CREATE FUNCTION` | function | referenced tables (requires body analysis) |
| `DROP *` | none | target object |

**Limitations of auto-extraction**:

| Case | Auto-extraction | Workaround |
|------|----------------|------------|
| `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` / `CREATE VIEW` | ✅ extractable | — |
| Table references inside `CREATE FUNCTION` body | ⚠️ partial | Static analysis of function body SQL, but dynamic SQL (`EXECUTE format(...)` etc.) is undetectable. Use explicit declarations |
| DDL inside `DO $$ ... $$` blocks | ❌ undetectable | Explicit declaration required |
| Dynamic SQL (`EXECUTE`, variable expansion) | ❌ undetectable | Explicit declaration required |
| Implicit schema references via `search_path` | ❌ undetectable | Explicit declaration required |
| Business-logic ordering dependencies (data dependencies) | ❌ out of scope | Explicit declaration required |

When auto-extraction fails to detect dependencies, `check` will pass without warning. Add explicit declarations when in doubt.

### Impact on check and apply (operational effect of editable = leaf)

In the dependency tree model, the concept of "latest file (tail)" is replaced by "leaf node (a file that no other file depends on)."

```
Overall editable determination:

  Linear model:   A → B → C → [D]
                                ↑ editable (tail only)

  DAG model:
            A (locked — B, C depend on it)
           / \
          B   C (locked — D, E depend on them)
          |     \
         [D]    [E] ← editable (leaf nodes)

  CI (check):
    - Non-leaf node modified → error
    - Leaf node modified → allowed
    - New file depends on existing leaf → that leaf transitions to locked
```

**Changes to apply**:
- Files are applied in topological sort order (dependencies first)
- Independent files have no ordering constraint
- On failure: only files depending on the failed file are blocked. Independent files are unaffected

```
Example: D fails

          A
         / \
        B   C
        |     \
       [D]     E ← independent of D, so apply proceeds

  D's failure does not block E's release
```

### Explicit Dependency Declaration

Auto-extraction from AST has limitations (dynamic SQL, business-logic dependencies, etc.). Dependencies that cannot be auto-extracted are explicitly declared via SQL file comments.

```sql
-- migraguard:depends-on 20260228_120000__create_users_table.sql

SET lock_timeout = '5s';
...
```

Or declared in `migraguard.config.json`:

```json
{
  "dependencies": {
    "20260301_093000__backfill_user_status.sql": [
      "20260228_120000__add_user_status_column.sql"
    ]
  }
}
```

**Priority**: Auto-extracted and explicit declarations are merged to build the final DAG. Explicit declarations do not override auto-extraction results; they are **composed as additional dependencies** (declarations cannot reduce dependencies). No conflicts arise; the final DAG is the union of both.

### Benefits for Large-Scale Systems

| Constraint | Linear Model | Dependency Tree Model |
|------------|-------------|----------------------|
| Concurrently modifiable files | 1 (tail only) | Number of leaf nodes (number of independent changes) |
| Parallel releases | Not possible (cannot add next until all environments complete) | Independent branches can be released in parallel |
| Error blast radius | All subsequent files blocked | Only dependent files blocked |
| Multi-team work | Serialized (one team at a time) | Parallel work possible for independent tables |

### Implementation Status

The dependency tree model was introduced incrementally as a superset of the linear model.

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Implement core features in linear model (new / apply / check / squash / lint / dump / verify) | ✅ Done |
| Phase 2 | Implement DDL dependency extraction via `libpg-query` and `migraguard deps` command | ✅ Done |
| Phase 3 | Extend check / apply / editable / squash for dependency tree support. Leaf node determination, topological sort application, independent branch continuation on partial failure | ✅ Done |

## Comparison with Existing Tools

migraguard's distinguishing feature is "embedding operational policies into the tool and preventing incidents via CI gates."

| Axis | migraguard | [Flyway](https://flywaydb.org/) | [Atlas](https://atlasgo.io/) | [Sqitch](https://sqitch.org/) | [Graphile Migrate](https://github.com/graphile/migrate) |
|------|-----------|---------|-------|--------|------------------|
| **Mutable unit** | tail (linear) / leaf node (DAG) | repeatable only | plan head | via dependency declaration | current.sql (dev only) |
| **Tamper detection** | checksum + CI gate (check) | checksum (at apply time) | Merkle hash tree (atlas.sum) | Merkle tree (sqitch.plan) | none |
| **Regression detection** | ✅ error on past checksum match | ❌ | ❌ | ❌ | ❌ |
| **Drift detection** | ✅ dump diff provided (apply --verify) | ❌ separate tooling needed | ✅ schema diff | ❌ | ⚠️ pg_dump recommended but not gated |
| **Idempotency verification** | ✅ verify (double-apply invariance check) | ❌ | ❌ | ❌ | ❌ |
| **Parallel releases** | ✅ dependency isolation via DAG | ❌ | ❌ | ⚠️ dependency declaration available | ❌ |
| **Failure handling** | failed/skipped recorded in DB, resolve for explicit judgment | repair overwrites checksum | manual fix | revert scripts | manual fix |
| **Offline integrity check** | ✅ check (CI-oriented) | ❌ | ✅ atlas.sum | ❌ | ❌ |
| **Execution engine** | psql (direct SQL execution) | Java / JDBC | Go / DB driver | psql / sqitch | pg (Node.js) |

### vs Flyway / Liquibase (general-purpose migration runners)

migraguard adds **offline tamper detection in CI** (check without DB), **regression detection** (past checksum match → error), **dynamic idempotency proof** (verify with shadow DB), and **apply mutual exclusion** (advisory lock). The trade-off: migraguard does not aim for a rich execution engine (JDBC, multi-DB, GUI). It relies on `psql` and SQL transparency instead.

### vs Atlas (declarative schema / hash tree)

Atlas drives migration from a "desired state" declaration. migraguard instead focuses on **preventing release-level operational incidents** — mid-sequence insertion, hotfix revert, failure suppression — via explicit CI gates. migraguard also supports **parallel releases via DAG** with AST-based dependency analysis, which Atlas does not. Choose Atlas if you want declarative schema-as-code generation; choose migraguard if your team writes DDL directly and needs incident guardrails.

### vs Sqitch (plan / dependency declaration)

Sqitch supports dependency declarations between migrations, but migraguard packages a **cohesive operational model** on top: leaf-only editability (DAG policy), verify (double-apply proof), regression detection, and failure blocking with explicit resolve. These are not separate features but a unified incident-prevention framework.

### vs Graphile Migrate (current.sql development experience)

Graphile Migrate optimizes for development speed (edit current.sql, auto-apply). migraguard preserves this speed during development (the latest file is freely re-applicable) but adds **"squash before release"** to guarantee one-file-per-release, which **simplifies production hotfix recovery** to: fix the file → re-apply.

## Mutual Exclusion for apply

Even with idempotent SQL, concurrent execution can cause race conditions. apply uses PostgreSQL advisory locks for mutual exclusion.

```
apply execution flow (with mutual exclusion):
  1. Establish DB connection
  2. Acquire pg_advisory_lock(hashtext('migraguard-apply'))
     → Blocks (waits) if another process is concurrently running apply
  3. Reference schema_migrations to determine pending files
  4. Execute each file via psql, record results in schema_migrations
  5. Close connection (advisory lock is automatically released)
```

Advisory locks are session-scoped, so apply must execute within a single session. If the connection drops, the lock is automatically released and re-execution is safe.

Prevents race conditions from parallel CI pipeline execution (concurrent apply to the same environment) and conflicts between manual apply and pipeline execution.

## DAG Migration Compatibility Policy

When migrating from the linear model to the dependency tree model, compatibility with existing schema_migrations must be maintained.

### Migration Steps

1. **Retain existing schema_migrations as-is**: Records from the linear model are treated as files with "implicitly fully-serial dependencies" in the DAG model
2. **Migration point marker**: Add `"model": "dag"` flag to metadata.json when introducing the DAG model. Files before this flag use linear ordering; files after use DAG analysis
3. **Backward compatibility**: DAG-aware migraguard can read linear model metadata.json. The reverse (downgrade from DAG to linear) is not supported

```
metadata.json migration example:

{
  "model": "dag",
  "modelSince": "20260401_000000__first_dag_migration.sql",
  "migrations": [
    {"file": "20260301_...", "checksum": "aaa"},  ← linear model era (treated as fully serial)
    {"file": "20260302_...", "checksum": "bbb"},  ← linear model era
    {"file": "20260401_...", "checksum": "ccc"}   ← DAG model (subject to dependency analysis)
  ]
}
```

### check / apply Behavior

- Files before `modelSince`: Checked linearly by timestamp as before
- Files after `modelSince`: Leaf node determination and topological sort via DAG analysis
- Boundary: The `modelSince` file implicitly depends on all prior files (inherits the linear model's final state)

## FAQ

### What happens if someone adds a comment to an already-applied migration?

Nothing. Checksums are computed on [normalized SQL](#checksum-normalization) — comments and whitespace are stripped before hashing. Adding comments, adjusting indentation, or inserting blank lines does not change the checksum.

### What happens if two CI pipelines run `apply` concurrently on the same DB?

One acquires the advisory lock and proceeds; the other blocks until the first completes, then runs with the updated `schema_migrations` state. No race condition occurs.

### A migration failed in production. How do I fix it?

If the failed file is the **latest** (or a leaf in DAG mode): fix the file and re-run `apply`. It will retry the failed file with the corrected SQL.

If the failed file is **not the latest**: either `resolve` it (marking it as skipped, confirming a subsequent migration covers the fix) or `squash` the failed file with its successor into a single corrected file.

### Someone accidentally reverted a hotfixed migration via git. Will migraguard catch it?

Yes. `apply` compares the file's current checksum against all past `schema_migrations` records. If it matches a **non-latest** past checksum, it raises a regression error and refuses to proceed.

### When should I switch from linear to DAG model?

See [When to Use DAG](#when-to-use-dag). In short: when multiple teams need to release independent schema changes in parallel, or when environment deploy lead times make the "deploy to all environments first" policy impractical.

### Does `verify` run against my production DB?

No. `verify` creates a temporary **shadow DB**, restores a dump of your current DB into it, applies migrations twice, then drops the shadow. Your production DB is never modified by `verify`.

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (Node.js) |
| DB connection | `psql` CLI (DDL files passed directly) |
| Schema dump | `pg_dump --schema-only` |
| SQL lint | [Squawk](https://squawkhq.com/) |
| SQL parser | [libpg-query](https://github.com/pganalyze/libpg-query) (PostgreSQL real parser WASM build, for DDL dependency analysis) |
| Package manager | npm |
