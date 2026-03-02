# Safe DDL Patterns for PostgreSQL

Since migraguard assumes plain SQL executed via `psql`, understanding safe DDL patterns is essential for production migrations. `migraguard lint` enforces these patterns via built-in rules using libpg-query AST analysis — no external tools required.

## Setting Lock Timeout

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

RESET lock_timeout;
RESET statement_timeout;
```

Without `lock_timeout`, `ALTER TABLE` can block for extended periods waiting for a table lock, stalling subsequent queries. Always set this in production.

**Rule**: `require-lock-timeout` — errors if DDL statements appear without prior `SET lock_timeout`.

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
