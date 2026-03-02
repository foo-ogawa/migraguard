# Safe DDL Patterns for PostgreSQL

Since migraguard assumes plain SQL executed via `psql`, understanding safe DDL patterns is essential for production migrations. `migraguard lint` enforces these patterns via built-in rules using libpg-query AST analysis — no external tools required.

## Timeout Discipline

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

RESET lock_timeout;
RESET statement_timeout;
```

Without `lock_timeout`, DDL can block for extended periods waiting for a table lock. Without `statement_timeout`, a heavy VALIDATE or backfill can run indefinitely. Both must be RESET at the end of the file to avoid leaking into subsequent operations.

**Rules**: `require-lock-timeout`, `require-statement-timeout`, `require-reset-timeouts`.

## CREATE INDEX CONCURRENTLY

```sql
-- CONCURRENTLY cannot be used inside a transaction
-- Ensure no BEGIN at the start of the file
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
```

A regular `CREATE INDEX` acquires an exclusive lock on the entire table. `CONCURRENTLY` avoids blocking writes but cannot run inside a transaction. Since `psql -v ON_ERROR_STOP=1 -f` executes files directly, do not include `BEGIN` / `COMMIT`.

**Rules**:
- `require-concurrent-index` — errors on `CREATE INDEX` without `CONCURRENTLY` (skipped for tables created in the same file)
- `ban-concurrent-index-in-transaction` — errors on `CREATE INDEX CONCURRENTLY` inside `BEGIN`...`COMMIT`

## Idempotent Statements (IF NOT EXISTS / IF EXISTS)

```sql
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);
DROP TABLE IF EXISTS temp_backup;
```

Without guards, a partially failed migration cannot be safely retried — the already-succeeded statements will error on re-execution.

**Rule**: `require-if-not-exists` — errors on CREATE TABLE/INDEX without `IF NOT EXISTS` and DROP without `IF EXISTS`.

## Adding NOT NULL Columns

```sql
-- Bad: blocks writes while scanning entire table for NULLs
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL;

-- Good: add with DEFAULT to avoid table rewrite (PG 11+)
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active';
```

**Rule**: `adding-not-nullable-field` — errors on adding a NOT NULL column without a DEFAULT value.

## Adding Constraints

```sql
-- Bad: full table scan, blocks writes
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);

-- Good: NOT VALID skips scan, then VALIDATE separately
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT fk_user;
```

**Rule**: `constraint-missing-not-valid` — errors on ADD CONSTRAINT (FOREIGN KEY / CHECK) without NOT VALID.

## Batch Large Data Backfills

```sql
UPDATE users SET status = 'active'
WHERE status IS NULL
  AND id BETWEEN 1 AND 100000;
```

Large-row UPDATEs are problematic for both lock duration and WAL write volume. Either batch in the application layer or segment ranges within the migration.

**Rule**: None. AST analysis cannot detect unbounded backfills. This must be enforced by code review.

## ANALYZE After CREATE INDEX

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ANALYZE users;
```

After creating an index, the query planner needs updated statistics to make optimal use of the new index. Always specify the target table — bare `ANALYZE;` (no table) analyzes the entire database and is dangerous in production.

**Rules**:
- `require-analyze-after-index` — errors if CREATE INDEX is not followed by `ANALYZE <table>` on the affected table. DROP INDEX is not checked (the affected table cannot be determined from the index name alone via AST).
- `ban-bare-analyze` — errors on `ANALYZE;` without table name. Bare ANALYZE scans the entire database and is dangerous in production.

## Views

```sql
-- Bad: fails on re-execution if view exists
CREATE VIEW active_users AS SELECT * FROM users WHERE active;

-- Good: idempotent
CREATE OR REPLACE VIEW active_users AS SELECT * FROM users WHERE active;
```

**Rule**: `require-create-or-replace-view` — errors on CREATE VIEW without OR REPLACE.

Avoid `DROP VIEW ... CASCADE` — it silently drops all dependent objects, making impact hard to track.

**Rule**: `ban-drop-cascade` — errors on any DROP with CASCADE.

## Destructive DDL

```sql
-- DROP COLUMN is irreversible and may break views/functions
ALTER TABLE users DROP COLUMN email;

-- ALTER COLUMN TYPE may rewrite the entire table
ALTER TABLE users ALTER COLUMN email TYPE TEXT;
```

Both are flagged by default. The safe alternative for type changes is: add new column → backfill → swap → drop old column (across multiple migrations).

**Rules**: `ban-drop-column`, `ban-alter-column-type`. Allow per-file with `-- migraguard:allow ban-drop-column` or disable globally in `lint.rules` config.

## DML in Migrations

```sql
-- Bad: affects all rows, no bound
UPDATE users SET status = 'active';
DELETE FROM users;

-- Good: bounded
UPDATE users SET status = 'active' WHERE status IS NULL AND id BETWEEN 1 AND 100000;
```

**Rules**: `ban-update-without-where`, `ban-delete-without-where`, `ban-truncate`.

## UNIQUE Constraints

```sql
-- Bad: acquires ACCESS EXCLUSIVE lock for index build
ALTER TABLE users ADD CONSTRAINT u_email UNIQUE (email);

-- Good: build index concurrently first, then attach
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ALTER TABLE users ADD CONSTRAINT u_email UNIQUE USING INDEX idx_users_email;
```

**Rule**: `require-unique-via-concurrent-index` — errors on direct UNIQUE constraint addition without USING INDEX.

## NOT VALID + VALIDATE Separation

```sql
-- File 1: add constraint without scanning (fast, no lock)
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

-- File 2 (separate migration): validate at a quiet time
ALTER TABLE orders VALIDATE CONSTRAINT fk_user;
```

**Rule**: `ban-validate-constraint-same-file` — errors if VALIDATE CONSTRAINT appears in the same file as the NOT VALID addition. Separating them gives control over timing.

## DROP INDEX

```sql
-- Bad: acquires ACCESS EXCLUSIVE lock
DROP INDEX IF EXISTS idx_users_email;

-- Good: non-blocking
DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;
```

**Rule**: `require-drop-index-concurrently` — errors on DROP INDEX without CONCURRENTLY.

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
| `SelectStmt` | SELECT |
| `InsertStmt` | INSERT |
| `UpdateStmt` | UPDATE |
| `DeleteStmt` | DELETE |
| `CreateFunctionStmt` | CREATE FUNCTION |
| `TransactionStmt` | BEGIN / COMMIT / ROLLBACK |
| `VariableSetStmt` | SET ... |
| `TruncateStmt` | TRUNCATE |
| `RenameStmt` | ALTER ... RENAME |

This is not a closed list. Any node type in the [libpg-query AST](https://github.com/pganalyze/libpg-query) can be used as a visitor key.

Each visitor receives `(node, ctx)`. Use `ctx.report({ message, hint })` to flag violations. `ctx` also provides shared state: `createdTables`, `lockTimeoutSet`, `inTransaction`.

Custom rules can be disabled via `lint.rules` by their `id`, just like built-in rules.
