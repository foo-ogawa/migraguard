# migraguard Implementation Plan Checklist

## Phase 1-A: Foundation Modules

- [x] A1: `src/config.ts` — Config file loading, validation, and environment variable overrides
  - [x] Implementation
  - [x] Unit tests (`tests/config.test.ts`) — 14 tests
  - [x] Lint check passed
- [x] A2: `src/naming.ts` — Filename generation, parsing, timestamp extraction, sort key
  - [x] Implementation
  - [x] Unit tests (`tests/naming.test.ts`) — 21 tests
  - [x] Lint check passed
- [x] A3: `src/checksum.ts` — SHA-256 checksum calculation
  - [x] Implementation
  - [x] Unit tests (`tests/checksum.test.ts`) — 7 tests
  - [x] Lint check passed
- [x] A4: `src/scanner.ts` — Migration file scanning and sorting
  - [x] Implementation
  - [x] Unit tests (`tests/scanner.test.ts`) — 9 tests
  - [x] Lint check passed
- [x] A5: `src/metadata.ts` — metadata.json reading, writing, and validation
  - [x] Implementation
  - [x] Unit tests (`tests/metadata.test.ts`) — 13 tests
  - [x] Lint check passed

## Phase 1-B: Commands Not Requiring DB Connection

- [x] B1: `src/commands/new.ts` — New migration SQL file generation
  - [x] Implementation
  - [x] CLI integration
  - [x] Unit tests (`tests/commands/new.test.ts`) — 7 tests
  - [x] Lint check passed
- [x] B2: `src/commands/check.ts` — Integrity check between metadata.json and files
  - [x] Implementation
  - [x] CLI integration
  - [x] Unit tests (`tests/commands/check.test.ts`) — 11 tests
  - [x] Lint check passed
- [x] B3: `src/commands/squash.ts` — New file squash
  - [x] Implementation
  - [x] CLI integration
  - [x] Unit tests (`tests/commands/squash.test.ts`) — 8 tests
  - [x] Lint check passed
- [x] B4: `src/commands/lint.ts` — Squawk lint execution
  - [x] Implementation
  - [x] CLI integration
  - [x] Unit tests (`tests/commands/lint.test.ts`) — 3 tests
  - [x] Lint check passed
- [x] B5: `src/commands/editable.ts` — Editable file list (without DB)
  - [x] Implementation
  - [x] CLI integration
  - [x] Unit tests (`tests/commands/editable.test.ts`) — 8 tests
  - [x] Lint check passed

## Phase 1-C: DB Connection Infrastructure + DB-Required Commands

- [x] C1: `src/db.ts` — PostgreSQL connection, schema_migrations table management, advisory lock
  - [x] Implementation
  - [x] Unit tests (`tests/db.test.ts`) — 2 tests
  - [x] Integration tests (covered by `full-scenario.test.ts`)
  - [x] Lint check passed
- [x] C2: `src/psql.ts` — psql CLI execution wrapper
  - [x] Implementation
  - [x] Unit tests (`tests/psql.test.ts`) — 2 tests
  - [x] Lint check passed
- [x] C3: `src/commands/apply.ts` — Migration application (full apply flow)
  - [x] Implementation
  - [x] CLI integration
  - [x] Integration tests (covered by `full-scenario.test.ts`)
  - [x] Lint check passed
- [x] C4: `src/commands/status.ts` — Migration status display
  - [x] Implementation
  - [x] CLI integration
  - [x] Integration tests (covered by `full-scenario.test.ts`)
  - [x] Lint check passed
- [x] C5: `src/commands/resolve.ts` — Mark failed migration as skipped
  - [x] Implementation
  - [x] CLI integration
  - [x] Integration tests (covered by `full-scenario.test.ts`)
  - [x] Lint check passed
- [x] C6: `src/commands/editable.ts` — Editable file list (extended for DB-connected mode)
  - [x] Implementation (also displays failed-retryable files when connected to DB)
  - [x] Integration tests (covered by `full-scenario.test.ts`)
  - [x] Lint check passed
- [x] C7: `src/dumper.ts` — pg_dump execution and normalization
  - [x] Implementation
  - [x] Unit tests (`tests/dumper.test.ts`) — 8 tests
  - [x] Lint check passed
- [x] C8: `src/commands/dump.ts` — Schema dump save
  - [x] Implementation
  - [x] CLI integration
  - [x] Integration tests (covered by `full-scenario.test.ts`)
  - [x] Lint check passed
- [x] C9: `src/commands/diff.ts` — Schema diff display
  - [x] Implementation
  - [x] CLI integration
  - [x] Integration tests (covered by `full-scenario.test.ts`)
  - [x] Lint check passed
- [x] C10: `src/commands/apply.ts` — `--verify` option support
  - [x] Implementation
  - [x] Integration tests
  - [x] Lint check passed

## Integration Test Environment + E2E Scenarios

- [x] `docker-compose.test.yml` — PostgreSQL 16 test environment
- [x] `tests/integration/helpers.ts` — Test DB operation helpers
- [x] `tests/integration/full-scenario.test.ts` — 25 tests
  - [x] Sprint 1: User management — new → squash → check → apply → status → editable
  - [x] Sprint 2: SNS follow feature — squash → check → apply → status
  - [x] Sprint 3: Chat rooms — squash → check → apply → table verification
  - [x] Sprint 4: DM + read receipts — check → apply → idempotency verification
  - [x] Idempotency (re-apply skip)
  - [x] Re-apply on latest file change
  - [x] Regression detection
  - [x] Tamper detection
  - [x] failed → resolve → apply success
  - [x] dump → diff → drift detection
  - [x] apply --verify: block on drift
  - [x] apply --verify: update schema.sql after success
  - [x] editable with DB: failed-retryable file display
  - [x] verify --all: idempotent DDL passes
  - [x] verify --all: non-idempotent DDL failure detected
  - [x] verify (incremental): existing DB restore → idempotency verification of pending migrations
  - [x] verify (incremental): non-idempotent pending DDL failure detected

## verify Command

- [x] `src/commands/verify.ts` — Shadow DB creation and idempotency verification
  - [x] Shadow DB lifecycle (CREATE → verify → DROP)
  - [x] `--all` mode: apply all files twice from empty DB
  - [x] Incremental mode: restore existing DB dump → reference schema_migrations → verify only pending migrations
  - [x] CLI integration
  - [x] Integration tests (4 cases)
  - [x] Lint check passed

## Phase 2: Dependency Analysis (display only)

- [x] 2-1: SQL parser library selection and integration
  - [x] Adopted `@pg-nano/pg-parser` (TypeScript fork of libpg_query with AST walk/select utilities)
- [x] 2-2: `src/deps.ts` — DDL AST analysis, object creation/dependency extraction
  - [x] Implementation (supports CREATE TABLE / ALTER TABLE / CREATE INDEX / CREATE VIEW / DROP / CREATE FUNCTION)
  - [x] Unit tests (`tests/deps.test.ts`) — 16 tests
  - [x] Lint check passed
- [x] 2-3: Explicit dependency declaration parsing (comment `-- migraguard:depends-on` / config `dependencies`)
  - [x] Implementation
  - [x] Unit tests (`tests/deps.test.ts`) — 4 tests
  - [x] Lint check passed
- [x] 2-4: DAG construction (merge auto-extraction + explicit declarations), cycle detection
  - [x] Implementation (includes topological sort, leaf node determination, transitive dependency file search)
  - [x] Unit tests (`tests/deps.test.ts`) — 8 tests
  - [x] Lint check passed
- [x] 2-5: `src/commands/deps.ts` — Tree format output (◆=editable / ◇=locked markers)
  - [x] Implementation
  - [x] CLI integration
  - [x] Unit tests (`tests/commands/deps.test.ts`) — 4 tests
  - [x] Lint check passed

## Phase 3: DAG Model Support

- [x] 3-1: Add model/modelSince fields to metadata.json with backward-compatible reading
  - [x] Implementation (`isDagMode()` / `isPreModelSince()` helpers)
  - [x] Unit tests (backward compatibility confirmed with existing `tests/metadata.test.ts` — 13 tests)
  - [x] Lint check passed
- [x] 3-2: `check` extension — leaf node determination, linear/DAG switching around modelSince
  - [x] Implementation (DAG mode: checksum changes allowed only for leaf nodes, multiple new files / mid-sequence insertion checks disabled)
  - [x] Unit tests (`tests/commands/check.test.ts`) — 11 tests (+3 DAG tests)
  - [x] Lint check passed
- [x] 3-3: `apply` extension — topological sort application, partial blocking
  - [x] Implementation (DAG mode: apply in topological sort order, block only dependent files on failure, continue independent files)
  - [x] Integration tests (all existing tests pass, confirming linear mode backward compatibility)
  - [x] Lint check passed
- [x] 3-4: `editable` extension — leaf node display
  - [x] Implementation (DAG mode: display leaf nodes with reason: 'leaf')
  - [x] Unit tests (`tests/commands/editable.test.ts`) — 8 tests (+2 DAG tests)
  - [x] Lint check passed
- [x] 3-5: `squash` extension — DAG-aware squash validation
  - [x] Implementation (undirected connectivity check: reject squash across independent branches)
  - [x] Unit tests (`tests/commands/squash.test.ts`) — 8 tests (+2 DAG tests)
  - [x] Lint check passed
- [x] 3-6: Integration tests — DAG scenarios (independent branches, partial failure, regression) — 7 tests
  - [x] Parallel apply of independent branches (follows + chat_rooms added simultaneously)
  - [x] deps tree correctly displays dependency structure
  - [x] Partial failure (follows fails → chat_rooms apply succeeds)
  - [x] Partial failure propagation (chat_rooms fails → chat_messages blocked, follows succeeds)
  - [x] Leaf node modification → re-apply succeeds
  - [x] Non-leaf node tamper detection
  - [x] Regression detection works in DAG mode too
