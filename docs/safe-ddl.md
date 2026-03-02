# Safe DDL Patterns for PostgreSQL

Since migraguard assumes plain SQL executed via `psql`, understanding safe DDL patterns is essential for production migrations. `migraguard lint` enforces these patterns via built-in rules using libpg-query AST analysis — no external tools required.

## Timeout Discipline

DDL statements acquire table locks. Without `lock_timeout`, a lock wait can block indefinitely, stalling all subsequent queries on the table. Without `statement_timeout`, a heavy VALIDATE or backfill can run forever. Both are direct causes of production incidents. Failing to RESET after SET leaks the timeout setting into subsequent operations in the same session.

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

RESET lock_timeout;
RESET statement_timeout;
```

**Rules**: `require-lock-timeout`, `require-statement-timeout`, `require-reset-timeouts`.

## CREATE INDEX CONCURRENTLY

A regular `CREATE INDEX` acquires an ACCESS EXCLUSIVE lock on the target table, blocking both reads and writes for the duration of the index build. On production tables this can mean minutes to hours of downtime. `CONCURRENTLY` minimizes locking but cannot run inside a transaction block.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
```

**Rules**:
- `require-concurrent-index` — errors on CREATE INDEX without CONCURRENTLY (skipped for tables created in the same file)
- `ban-concurrent-index-in-transaction` — errors on CONCURRENTLY inside BEGIN...COMMIT

## Idempotent Statements (IF NOT EXISTS / IF EXISTS)

When a migration fails partway through, the already-succeeded statements will error on re-execution (e.g., "table already exists"). Adding `IF NOT EXISTS` / `IF EXISTS` makes every statement safe to re-run. This is the foundation of migraguard's design: fail → fix → re-apply.

```sql
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
DROP TABLE IF EXISTS temp_backup;
```

**Rule**: `require-if-not-exists` — errors on CREATE TABLE/INDEX without IF NOT EXISTS and DROP without IF EXISTS.

## Adding NOT NULL Columns

Adding a NOT NULL column without a DEFAULT forces PostgreSQL to scan every row to verify no NULLs exist. On large tables this causes a long-held exclusive lock and a full table rewrite. Since PostgreSQL 11, adding a NOT NULL column with a DEFAULT is a metadata-only operation that completes instantly.

```sql
-- Bad: full table scan + exclusive lock
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL;

-- Good: metadata-only change (PG 11+)
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active';
```

**Rule**: `adding-not-nullable-field` — errors on adding a NOT NULL column without a DEFAULT value.

## Adding Constraints

Adding a FOREIGN KEY or CHECK constraint directly causes PostgreSQL to scan the entire table to validate the constraint. The table is write-locked during this scan. Using `NOT VALID` skips the validation and adds the constraint instantly. `VALIDATE CONSTRAINT` can then verify existing rows in a non-blocking manner.

```sql
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
-- In a separate migration:
ALTER TABLE orders VALIDATE CONSTRAINT fk_user;
```

**Rule**: `constraint-missing-not-valid` — errors on adding FOREIGN KEY / CHECK constraints without NOT VALID.

## NOT VALID + VALIDATE Separation

If you add a constraint with NOT VALID and then VALIDATE it in the same migration file, you lose the benefit — the full table scan runs in the same deployment. Separating VALIDATE into a different migration gives you control over timing (e.g., run during low-traffic hours).

```sql
-- File 1: add constraint (fast, no lock)
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

-- File 2 (separate migration): validate (timing controlled)
ALTER TABLE orders VALIDATE CONSTRAINT fk_user;
```

**Rule**: `ban-validate-constraint-same-file` — errors if NOT VALID and VALIDATE CONSTRAINT appear in the same file.

## UNIQUE Constraints

Adding a UNIQUE constraint via `ALTER TABLE ... ADD CONSTRAINT UNIQUE (col)` internally builds an index while holding an exclusive lock. Creating the index first with `CREATE UNIQUE INDEX CONCURRENTLY` avoids blocking writes, then attaching it with `USING INDEX` is a metadata-only operation.

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ALTER TABLE users ADD CONSTRAINT u_email UNIQUE USING INDEX idx_users_email;
```

**Rule**: `require-unique-via-concurrent-index` — errors on direct UNIQUE constraint addition without USING INDEX.

## PRIMARY KEY Constraints

Adding a PRIMARY KEY via `ALTER TABLE ... ADD PRIMARY KEY (col)` internally builds a unique index while holding an ACCESS EXCLUSIVE lock, blocking all reads and writes for the duration. The safe pattern is identical to UNIQUE constraints: create the index concurrently first, then attach it.

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS account_pk_idx ON account (id);
ALTER TABLE account ADD CONSTRAINT account_pk PRIMARY KEY USING INDEX account_pk_idx;
```

**Rule**: `require-pk-via-concurrent-index` — errors on direct PRIMARY KEY addition without USING INDEX.

## SET NOT NULL on Existing Columns

`ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` acquires an ACCESS EXCLUSIVE lock and scans all rows to verify no NULLs exist. On large tables this causes extended downtime. The safe pattern (PG 12+) is to add a CHECK constraint with NOT VALID, validate it separately, then apply SET NOT NULL (which becomes a metadata-only operation once a validated CHECK constraint exists).

```sql
-- Step 1: add constraint without validation (fast, no scan)
ALTER TABLE users ADD CONSTRAINT users_email_not_null CHECK (email IS NOT NULL) NOT VALID;

-- Step 2 (separate migration): validate existing rows (non-blocking)
ALTER TABLE users VALIDATE CONSTRAINT users_email_not_null;

-- Step 3 (separate migration): now SET NOT NULL is metadata-only
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
```

**Rule**: `ban-set-not-null` — errors on SET NOT NULL. Use the CHECK NOT VALID → VALIDATE → SET NOT NULL pattern instead.

## ENUM Types in Transactions

`ALTER TYPE ... ADD VALUE` cannot be rolled back — if the transaction is aborted, the new enum value remains. On PostgreSQL versions before 12, this statement cannot run inside a transaction at all. Even on PG 12+, placing it inside a transaction provides a false sense of safety since it cannot be rolled back.

```sql
-- Bad: inside a transaction
BEGIN;
ALTER TYPE status ADD VALUE 'archived';
COMMIT;

-- Good: outside a transaction
ALTER TYPE status ADD VALUE 'archived';
```

**Rule**: `ban-alter-enum-in-transaction` — errors on ALTER TYPE ... ADD VALUE inside BEGIN...COMMIT.

## ANALYZE After CREATE INDEX

After creating an index, the query planner may not use it optimally until table statistics are updated. Autovacuum will eventually run ANALYZE, but there is a lag. Explicitly running `ANALYZE <table>` in the migration ensures immediate planner awareness. A bare `ANALYZE;` without a table name scans the entire database and is dangerous in production.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ANALYZE users;
```

**Rules**:
- `require-analyze-after-index` — errors if CREATE INDEX is not followed by `ANALYZE <table>` on the affected table (DROP INDEX is not checked — the affected table cannot be determined from the index name via AST)
- `ban-bare-analyze` — errors on `ANALYZE;` without a table name

## Views

PostgreSQL's `CREATE VIEW` fails if the view already exists. `CREATE OR REPLACE VIEW` makes it idempotent. However, using `SELECT *` in a view definition causes `OR REPLACE` to fail when the base table's columns change (column count/name compatibility breaks). Listing columns explicitly makes views resilient to schema evolution.

```sql
-- Good: idempotent + explicit columns
CREATE OR REPLACE VIEW active_users AS
  SELECT id, name, email FROM users WHERE active;
```

**Rules**:
- `require-create-or-replace-view` — errors on CREATE VIEW without OR REPLACE
- `ban-select-star-in-view` — errors on SELECT * in VIEW or MATERIALIZED VIEW definitions

`DROP VIEW ... CASCADE` silently drops all dependent objects, making impact difficult to trace.

**Rule**: `ban-drop-cascade` — errors on any DROP with CASCADE.

## Materialized Views

Materialized views (MVs) hold physical data and require `REFRESH` to update. REFRESH recomputes all data, causing significant lock contention and execution time. Migrations should only handle creation, indexing, and ANALYZE — REFRESH belongs in a separate operational job. The stable pattern is to create MVs with versioned names and expose them via regular VIEWs (switchable with OR REPLACE).

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS user_stats_mv AS
  SELECT user_id, count(*) AS post_count FROM posts GROUP BY user_id
  WITH NO DATA;

CREATE OR REPLACE VIEW user_stats AS SELECT user_id, post_count FROM user_stats_mv;
```

**Rules**:
- `require-if-not-exists-materialized-view` — errors on CREATE MATERIALIZED VIEW without IF NOT EXISTS
- `ban-refresh-materialized-view-in-migration` — errors on REFRESH MATERIALIZED VIEW in migration files

## Renaming Columns and Tables

Renaming a column or table breaks every existing query, view, function, and application code that references the old name. During rolling deployments, old application instances will fail immediately after the rename is applied. There is no safe way to rename in a single step.

```sql
-- Both flagged by default
ALTER TABLE users RENAME COLUMN email TO email_address;
ALTER TABLE users RENAME TO customers;
```

**Rules**: `ban-rename-column`, `ban-rename-table`. For column renames, consider adding a new column and deprecating the old one. For table renames, consider using a VIEW to alias the new name.

## Destructive DDL

`DROP TABLE` and `DROP COLUMN` are irreversible and can break dependent views, functions, and application code. `ALTER COLUMN TYPE` may trigger a full table rewrite with an exclusive lock, causing extended downtime on large tables. The safe alternative for type changes is: add new column → backfill → swap references → drop old column (across multiple migrations).

```sql
-- All flagged by default
DROP TABLE users;
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users ALTER COLUMN email TYPE TEXT;
```

**Rules**: `ban-drop-table`, `ban-drop-column`, `ban-alter-column-type`. Allow per-file with `-- migraguard:allow ban-drop-table` or disable globally in `lint.rules` config.

## DML in Migrations

UPDATE or DELETE without a WHERE clause affects every row, causing long-held row locks and massive WAL writes. TRUNCATE acquires an ACCESS EXCLUSIVE lock and is irreversible. DML in migrations must always be bounded by a WHERE condition. Large data changes should be batched.

```sql
-- Bad: affects all rows
UPDATE users SET status = 'active';
DELETE FROM users;

-- Good: bounded
UPDATE users SET status = 'active' WHERE status IS NULL AND id BETWEEN 1 AND 100000;
```

**Rules**: `ban-update-without-where`, `ban-delete-without-where`, `ban-truncate`.

## Batch Large Data Backfills

Updating a large number of rows in a single statement is problematic for both lock duration and WAL volume. Instead of updating all rows at once, split by primary key range or batch in the application layer. This pattern cannot be detected by AST analysis and must be enforced by code review.

```sql
UPDATE users SET status = 'active'
WHERE status IS NULL
  AND id BETWEEN 1 AND 100000;
```

**Rule**: None. AST analysis cannot detect unbounded backfills. Enforce via code review.

## DROP INDEX

A regular `DROP INDEX` acquires an ACCESS EXCLUSIVE lock, blocking all access to the table. `DROP INDEX CONCURRENTLY` removes the index without blocking writes. As with CREATE INDEX, CONCURRENTLY is essential for production tables.

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;
```

**Rule**: `require-drop-index-concurrently` — errors on DROP INDEX without CONCURRENTLY.

## Dangerous Operational Commands

Several PostgreSQL commands acquire heavy locks or modify cluster-wide settings. These belong in operational runbooks, not in migration files.

`VACUUM FULL` rewrites the entire table under an ACCESS EXCLUSIVE lock — reads and writes are blocked for the duration. Normal `VACUUM` (without FULL) is non-blocking and is the correct choice for routine maintenance.

`CLUSTER` physically reorders a table's rows according to an index, also requiring an ACCESS EXCLUSIVE lock and a full table rewrite.

`REINDEX` rebuilds indexes. Without `CONCURRENTLY` it acquires an ACCESS EXCLUSIVE lock; even with `CONCURRENTLY` it takes a SHARE lock. Either way it should be managed as an operational task, not embedded in migrations.

`ALTER SYSTEM` writes to `postgresql.auto.conf` and affects the entire database cluster. Server configuration must be managed via configuration management tools, not migrations.

`SET session_replication_role` disables triggers and foreign key enforcement for the session. This can silently corrupt data integrity and should never appear in migrations.

```sql
-- All flagged by default
VACUUM FULL users;
CLUSTER users USING idx_users_email;
REINDEX TABLE users;
ALTER SYSTEM SET work_mem = '256MB';
SET session_replication_role = 'replica';
```

**Rules**: `ban-vacuum-full`, `ban-cluster`, `ban-reindex`, `ban-alter-system`, `ban-set-session-replication-role`.

## Custom Lint Rules

Project-specific rules can be added as `.js` / `.mjs` files. Set `lint.customRulesDir` in `migraguard.config.json`:

```json
{ "lint": { "customRulesDir": "lint-rules" } }
```

Each file must default-export a `LintRule` object. The type is available via `import('migraguard').LintRule`.

### Example: FK Column Naming Convention

```javascript
// lint-rules/require-fk-column-suffix.js
/** @type {import('migraguard').LintRule} */
export default {
  id: 'require-fk-column-suffix',
  description: 'FK columns must end with _id',
  create() {
    return {
      CreateStmt(node, ctx) {
        const tableElts = node.tableElts;
        if (!Array.isArray(tableElts)) return;
        for (const elt of tableElts) {
          if (!elt.ColumnDef) continue;
          const col = elt.ColumnDef;
          const constraints = col.constraints;
          if (!Array.isArray(constraints)) continue;
          const hasFk = constraints.some(
            (c) => c.Constraint && c.Constraint.contype === 'CONSTR_FOREIGN',
          );
          if (hasFk && !col.colname?.endsWith('_id')) {
            ctx.report({
              message: `FK column "${col.colname}" does not end with _id`,
              hint: 'Rename to end with _id',
            });
          }
        }
      },
    };
  },
};
```

### Available Visitors

Any PostgreSQL AST node type can be used as a visitor key. Common examples:

| Visitor | Triggered by |
|---------|-------------|
| `CreateStmt` | CREATE TABLE |
| `IndexStmt` | CREATE INDEX |
| `AlterTableStmt` | ALTER TABLE |
| `DropStmt` | DROP TABLE / INDEX / VIEW / ... |
| `ViewStmt` | CREATE VIEW |
| `CreateTableAsStmt` | CREATE MATERIALIZED VIEW |
| `RefreshMatViewStmt` | REFRESH MATERIALIZED VIEW |
| `SelectStmt` | SELECT |
| `InsertStmt` | INSERT |
| `UpdateStmt` | UPDATE |
| `DeleteStmt` | DELETE |
| `CreateFunctionStmt` | CREATE FUNCTION |
| `TransactionStmt` | BEGIN / COMMIT / ROLLBACK |
| `VariableSetStmt` | SET ... |
| `VacuumStmt` | ANALYZE / VACUUM |
| `TruncateStmt` | TRUNCATE |
| `RenameStmt` | ALTER ... RENAME |
| `AlterEnumStmt` | ALTER TYPE ... ADD VALUE |
| `ClusterStmt` | CLUSTER |
| `ReindexStmt` | REINDEX |
| `AlterSystemStmt` | ALTER SYSTEM |

This is not a closed list. Any node type in the [libpg-query AST](https://github.com/pganalyze/libpg-query) can be used as a visitor key.

Each visitor receives `(node, ctx)`. Use `ctx.report({ message, hint })` to flag violations. `ctx` also provides shared state: `createdTables`, `lockTimeoutSet`, `inTransaction`.

Custom rules can be disabled via `lint.rules` by their `id`, just like built-in rules.
