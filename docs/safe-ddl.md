# Safe DDL Patterns for PostgreSQL

Since migraguard assumes plain SQL executed via `psql`, understanding safe DDL patterns is essential for production migrations. Most of these patterns are enforced by [Squawk](https://squawkhq.com/) via `migraguard lint`.

## Setting Lock Timeout

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

RESET lock_timeout;
RESET statement_timeout;
```

Without `lock_timeout`, `ALTER TABLE` can block for extended periods waiting for a table lock, stalling subsequent queries. Always set this in production.

**Squawk rule**: [`require-timeout-settings`](https://squawkhq.com/docs/require-timeout-settings) — errors if DDL statements appear without prior `SET lock_timeout` / `SET statement_timeout`.

## CREATE INDEX CONCURRENTLY

```sql
-- CONCURRENTLY cannot be used inside a transaction
-- Ensure no BEGIN at the start of the file
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
```

A regular `CREATE INDEX` acquires an exclusive lock on the entire table. `CONCURRENTLY` avoids blocking writes but cannot run inside a transaction. Since `psql -v ON_ERROR_STOP=1 -f` executes files directly, do not include `BEGIN` / `COMMIT`.

**Squawk rules**:
- [`require-concurrent-index-creation`](https://squawkhq.com/docs/require-concurrent-index-creation) — errors on `CREATE INDEX` without `CONCURRENTLY`
- [`ban-concurrent-index-creation-in-transaction`](https://squawkhq.com/docs/ban-concurrent-index-creation-in-transaction) — errors on `CREATE INDEX CONCURRENTLY` inside a transaction

## Idempotent Statements (IF NOT EXISTS / IF EXISTS)

```sql
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);
DROP TABLE IF EXISTS temp_backup;
```

Without guards, a partially failed migration cannot be safely retried — the already-succeeded statements will error on re-execution.

**Squawk rule**: [`prefer-robust-stmts`](https://squawkhq.com/docs/prefer-robust-stmts) — errors on DDL without `IF NOT EXISTS` / `IF EXISTS` guards outside a transaction.

## Batch Large Data Backfills

```sql
UPDATE users SET status = 'active'
WHERE status IS NULL
  AND id BETWEEN 1 AND 100000;
```

Large-row UPDATEs are problematic for both lock duration and WAL write volume. Either batch in the application layer or segment ranges within the migration.

**Squawk rule**: None. Squawk cannot detect unbounded backfills. This must be enforced by code review.
