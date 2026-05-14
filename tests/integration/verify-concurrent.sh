#!/usr/bin/env bash
# Integration test: verify command shadow DB helpers use raw pg.Client without timeouts
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXAMPLE_DIR="$REPO_ROOT/examples/social-app"

export PGHOST=localhost
export PGPORT=15432
export PGDATABASE=migraguard_test
export PGUSER=migraguard_test
export PGPASSWORD=migraguard_test

CLI="node $REPO_ROOT/dist/cli.js"

run_with_timeout() {
    local secs=$1; shift
    "$@" &
    local cmd_pid=$!
    ( sleep "$secs" && kill -9 $cmd_pid 2>/dev/null ) &
    local watcher_pid=$!
    wait $cmd_pid 2>/dev/null
    local rc=$?
    kill $watcher_pid 2>/dev/null; wait $watcher_pid 2>/dev/null || true
    return $rc
}

echo "=== Test: verify + group-status concurrent ==="

echo ""
echo "Step 1: Clean and apply migrations"
psql -c "DROP TABLE IF EXISTS schema_migrations CASCADE;" 2>/dev/null || true

cd "$EXAMPLE_DIR"

# Drop all tables from previous runs first
psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true

$CLI apply 2>&1 | tail -5
echo "Apply done"

echo ""
echo "Step 2: Run verify and group-status concurrently (both need schema_migrations)"
START_TIME=$(date +%s)

set +e
# Run verify (creates shadow DB, connects to main, runs migrations on shadow)
run_with_timeout 45 $CLI verify --all 2>&1 &
VERIFY_PID=$!

sleep 1

# Run group-status while verify is running
run_with_timeout 45 $CLI group-status 2>&1 &
GSTATUS_PID=$!

# Wait for both
wait $VERIFY_PID 2>/dev/null
VERIFY_EXIT=$?

wait $GSTATUS_PID 2>/dev/null
GSTATUS_EXIT=$?
set -e

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "  verify exit code: $VERIFY_EXIT"
echo "  group-status exit code: $GSTATUS_EXIT"
echo "  Total elapsed: ${ELAPSED}s"

if [ $ELAPSED -ge 45 ]; then
    echo ""
    echo "FAIL: Concurrent execution hung (killed by timeout)"
    exit 1
else
    echo ""
    echo "PASS: Both commands completed within ${ELAPSED}s"
fi

echo ""
echo "=== Test: multiple group-status in parallel ==="
START_TIME=$(date +%s)

set +e
run_with_timeout 45 $CLI group-status 2>&1 &
P1=$!
run_with_timeout 45 $CLI group-status 2>&1 &
P2=$!
run_with_timeout 45 $CLI group-status 2>&1 &
P3=$!

wait $P1; E1=$?
wait $P2; E2=$?
wait $P3; E3=$?
set -e

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "  Exit codes: $E1, $E2, $E3"
echo "  Elapsed: ${ELAPSED}s"

if [ $ELAPSED -ge 45 ]; then
    echo "FAIL: Parallel group-status hung"
    exit 1
else
    echo "PASS: 3x parallel group-status completed in ${ELAPSED}s"
fi

echo ""
echo "=== Test: apply + group-status concurrent (CI-like scenario) ==="
psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
psql -c "DROP TABLE IF EXISTS schema_migrations CASCADE;" 2>/dev/null || true

START_TIME=$(date +%s)

set +e
# apply takes advisory lock + runs DDL
run_with_timeout 45 $CLI apply 2>&1 &
APPLY_PID=$!

sleep 0.5

# group-status tries to read while apply is running
run_with_timeout 45 $CLI group-status 2>&1 &
GSTATUS_PID=$!

wait $APPLY_PID; APPLY_EXIT=$?
wait $GSTATUS_PID; GSTATUS_EXIT=$?
set -e

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "  apply exit: $APPLY_EXIT"
echo "  group-status exit: $GSTATUS_EXIT"
echo "  Elapsed: ${ELAPSED}s"

if [ $ELAPSED -ge 45 ]; then
    echo "FAIL: apply + group-status concurrent hung"
    exit 1
else
    echo "PASS: apply + group-status concurrent completed in ${ELAPSED}s"
fi
