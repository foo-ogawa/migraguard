# DAG Model: Dependency Analysis Internals

## Dependency Analysis Method

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

### Extractable DDL and Dependency Types

| DDL | Creates | Depends On |
|-----|---------|------------|
| `CREATE TABLE` | table | none (referenced tables if REFERENCES present) |
| `ALTER TABLE ADD COLUMN` | column | table |
| `ALTER TABLE ADD CONSTRAINT` | constraint | table, columns, referenced tables |
| `CREATE INDEX` | index | table, columns |
| `CREATE VIEW` | view | referenced tables |
| `CREATE FUNCTION` | function | referenced tables (requires body analysis) |
| `DROP *` | none | target object |

### Limitations of Auto-Extraction

| Case | Auto-extraction | Workaround |
|------|----------------|------------|
| `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` / `CREATE VIEW` | ✅ extractable | — |
| Table references inside `CREATE FUNCTION` body | ⚠️ partial | Static analysis of function body SQL, but dynamic SQL (`EXECUTE format(...)` etc.) is undetectable. Use explicit declarations |
| DDL inside `DO $$ ... $$` blocks | ❌ undetectable | Explicit declaration required |
| Dynamic SQL (`EXECUTE`, variable expansion) | ❌ undetectable | Explicit declaration required |
| Implicit schema references via `search_path` | ❌ undetectable | Explicit declaration required |
| Business-logic ordering dependencies (data dependencies) | ❌ out of scope | Explicit declaration required |

When auto-extraction fails to detect dependencies, `check` will pass without warning. Add explicit declarations when in doubt.

## Explicit Dependency Declaration

Dependencies that cannot be auto-extracted are explicitly declared via SQL file comments:

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

Auto-extracted and explicit declarations are merged to build the final DAG. Explicit declarations are **composed as additional dependencies** (they cannot reduce dependencies). The final DAG is the union of both.

## Impact on check and apply

In the dependency tree model, "latest file (tail)" is replaced by "leaf node (a file that no other file depends on)."

```
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

**apply in DAG mode**:
- Files are applied in topological sort order (dependencies first)
- Independent files have no ordering constraint
- On failure: only files depending on the failed file are blocked; independent files are unaffected

```
Example: D fails

        A
       / \
      B   C
      |     \
     [D]     E ← independent of D, so apply proceeds

D's failure does not block E's release
```

## Squash in DAG Mode

New files are automatically split into connected components (groups) based on dependencies. Squash is performed per group; independent DDL remains as individual files.

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

## Benefits for Large-Scale Systems

| Constraint | Linear Model | Dependency Tree Model |
|------------|-------------|----------------------|
| Concurrently modifiable files | 1 (tail only) | Number of leaf nodes |
| Parallel releases | Not possible | Independent branches can be released in parallel |
| Error blast radius | All subsequent files blocked | Only dependent files blocked |
| Multi-team work | Serialized | Parallel work possible for independent tables |

## DAG Migration Compatibility Policy

When migrating from the linear model to the dependency tree model, compatibility with existing schema_migrations is maintained.

### Migration Steps

1. **Retain existing schema_migrations as-is**: Records from the linear model are treated as files with "implicitly fully-serial dependencies"
2. **Migration point marker**: Add `"model": "dag"` flag to metadata.json. Files before this flag use linear ordering; files after use DAG analysis
3. **Backward compatibility**: DAG-aware migraguard can read linear model metadata.json. The reverse (downgrade from DAG to linear) is not supported

```
metadata.json example:

{
  "model": "dag",
  "modelSince": "20260401_000000__first_dag_migration.sql",
  "migrations": [
    {"file": "20260301_...", "checksum": "aaa"},  ← linear model era (fully serial)
    {"file": "20260302_...", "checksum": "bbb"},  ← linear model era
    {"file": "20260401_...", "checksum": "ccc"}   ← DAG model (dependency analysis)
  ]
}
```

### check / apply Behavior at Boundary

- Files before `modelSince`: Checked linearly by timestamp as before
- Files after `modelSince`: Leaf node determination and topological sort via DAG analysis
- Boundary: The `modelSince` file implicitly depends on all prior files (inherits the linear model's final state)
