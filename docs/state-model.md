# State Model and Operational Flows

## schema_migrations: INSERT-only Design

The `schema_migrations` table uses `BIGSERIAL` as its PK. A new record is INSERTed every time, even for the same file and checksum. **No UPDATEs are ever performed.** This is a deliberate design choice, not a simplification.

UPDATE-based designs lose the history needed for regression detection (matching the current checksum against all past checksums). INSERT-only also provides a complete audit log of every application attempt, including failures.

### How Records Accumulate

- Re-application of the same file (e.g., hotfix with changed checksum) → INSERT a new record with the new checksum
- Re-execution with the same checksum (idempotent re-apply) → INSERT a new record with the same checksum (different `applied_at`)
- `failed` → re-execution after fix → The `failed` record remains; a new `applied` record is INSERTed
- `resolve` → The `failed` record remains; a `skipped` record with the same checksum is INSERTed

A file's "current state" is determined by the `status` of its latest record (maximum `applied_at`). Past records remain as an audit log.

### Status Meanings

| status | Meaning |
|--------|---------|
| `applied` | Successfully applied |
| `failed` | Application attempted but failed with error. Unresolved |
| `skipped` | Explicitly skipped via `migraguard resolve`. Human judgment that a subsequent forward migration covers the fix |

## Regression Detection

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

## Failure Recovery

```
Case 1: Latest file S1 fails (no files after S1)
  → Fix S1 and re-run apply (S1 is latest so modification is allowed, failed → retry)
  → A new applied record with the new checksum is added

Case 2: S2 was added after S1 failed (S1 is no longer the latest)
  → apply stops with error "S1 is unresolved"
  → Option A: migraguard resolve S1 → marks S1 as skipped; S2 covers the fix
  → Option B: squash S1 + S2 into a single file
```

## Resolve Behavior

```bash
npx migraguard resolve 20260301_093000__add_user_email.sql
```

- INSERTs a status=`skipped` record into `schema_migrations` with the same checksum as the file's latest failed record
- Records the current time in `resolved_at`
- Errors if the file's latest record is not `failed`
- An explicit operation that requires human confirmation that a subsequent forward migration covers the fix

## Check Flow (CI-oriented)

`migraguard check` is a file integrity check designed for CI environments. No DB connection required.

1. Read metadata.json
2. Compute checksums of all files in `migrationsDir`
3. Check the following:
   - Do checksums of files recorded in metadata.json match actual files (except the latest)?
   - Have any files other than the latest been modified?
   - Have new files been inserted mid-sequence?
   - **Are there 2 or more new files?** (linear model only; DAG mode allows multiple independent groups)
4. If any violation is found, exit with code 1 and output the diff details

### Limitations of check and Operational Policy

check does not connect to the DB, so it cannot determine "what has been applied to which environment." The following scenario illustrates a gap that operational policy must cover:

```
1. Create S1 → apply to dev (S1 applied)
2. Add S2 before applying S1 to pro
3. Apply S1 to pro → error → recorded as failed
4. Want to fix S1, but S2 is now the latest so check blocks modification
5. apply also stops with "S1 is unresolved" error
6. Recovery: migraguard resolve S1 → apply S2 (S2 covers S1's fix)
```

Recovery is possible, but whether S2 correctly covers S1's intent requires human judgment.

**Operational policy: Do not add the next migration until the current release is deployed to all environments**

If this policy is violated and a past file needs modification:
1. Do not modify past files directly (check will block)
2. Create a new forward migration containing corrective SQL
3. Squash the current new files and the forward migration into one

### Responsibilities of check vs apply

| | check | apply |
|---|---|---|
| Data source | metadata.json (repository) | schema_migrations table (DB) |
| DB connection | Not required | Required |
| Purpose | Pre-verification in CI (PR check) | Actual application to environments |
| Detection scope | File tampering, unauthorized additions, multiple new files | Identifying and applying pending files |

## Verification Details

### `apply --with-drift-check` — Schema Drift Gate

1. Dump the current DB schema and compare with the saved `schema.sql`
2. If they **differ** → error: schema drift detected, apply is blocked
3. If they match → proceed with apply
4. After apply completes, generate a new schema dump and update `schema.sql`

### `verify` — Dynamic Idempotency Proof

- `verify` (incremental): Dumps and restores the current DB to a shadow, then applies only pending migrations twice
- `verify --all`: Creates an empty shadow DB and applies all migrations from scratch twice

This is stronger than lint rules or conventions — it dynamically proves that every migration can be safely re-executed.

## Squash Flow

`migraguard squash` merges multiple migration files created during development into a single file. Run before merging to the release branch.

### Linear Model Behavior

1. Read metadata.json
2. Identify new files not recorded in metadata.json
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

`check` returns an error if there are 2 or more new files. This enforces running squash before push.

### Why One Release = One File

**Premise**: migraguard enforces tamper detection via the invariant that "only editable nodes can be modified." Squash makes this invariant practical.

**Failure scenario without squash**:

```
20260228__add_col.sql and 20260301__add_index.sql released while both pending
  → 20260228 fails with error
  → Want to fix it, but 20260301 is the latest file so check blocks changes to 20260228
  → Must use resolve + forward migration as a workaround, increasing incident risk
```

**With a single file**: Squashed file fails → fix that file → re-apply. Conforms to the editable node rule; safe to re-execute due to idempotency.

In DAG mode, independent DDL can be released as individual files. Squash is only enforced within each dependency chain. See [dag-internals.md](dag-internals.md) for DAG squash behavior.

## Mutual Exclusion for apply

Even with idempotent SQL, concurrent execution can cause race conditions. apply uses PostgreSQL advisory locks for mutual exclusion.

```
apply execution flow:
  1. Establish DB connection
  2. Acquire pg_advisory_lock(hashtext('migraguard-apply'))
     → Blocks (waits) if another process is concurrently running apply
  3. Reference schema_migrations to determine pending files
  4. Execute each file via psql, record results in schema_migrations
  5. Close connection (advisory lock is automatically released)
```

Advisory locks are session-scoped. If the connection drops, the lock is automatically released and re-execution is safe.
