#!/usr/bin/env bash
# Integration test: concurrent lock contention on schema_migrations
# Reproduces the CI hang where group-status blocks on ACCESS EXCLUSIVE lock
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

# portable timeout: run command with a deadline, kill if exceeded
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

echo "=== Step 1: Clean slate ==="
psql -c "DROP TABLE IF EXISTS schema_migrations CASCADE;" 2>/dev/null || true
echo "OK"

echo ""
echo "=== Step 2: Apply migrations ==="
cd "$EXAMPLE_DIR"
$CLI apply 2>&1 || true
echo "Done"

echo ""
echo "=== Step 3: Baseline group-status (no contention) ==="
run_with_timeout 15 $CLI group-status 2>&1
echo "Baseline: OK"

echo ""
echo "=== Step 4: Simulate ACCESS EXCLUSIVE lock on schema_migrations ==="
echo "  Holding lock for 60s in background..."
psql -c "BEGIN; LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(60); COMMIT;" &
LOCK_PID=$!
sleep 2
echo "  Lock holder PID: $LOCK_PID"

echo ""
echo "=== Step 5: group-status under contention (should timeout, NOT hang forever) ==="
START_TIME=$(date +%s)

set +e
run_with_timeout 50 $CLI group-status 2>&1
EXIT_CODE=$?
set -e

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

kill $LOCK_PID 2>/dev/null || true
wait $LOCK_PID 2>/dev/null || true

echo ""
echo "  Exit code: $EXIT_CODE"
echo "  Elapsed: ${ELAPSED}s"

if [ $ELAPSED -ge 50 ]; then
    echo ""
    echo "FAIL: group-status HUNG for ${ELAPSED}s (killed by outer timeout)"
    echo "  statement_timeout is NOT working — this is the bug."
    exit 1
elif [ $ELAPSED -ge 35 ]; then
    echo ""
    echo "PASS (slow): statement_timeout fired at ${ELAPSED}s"
    exit 0
else
    echo ""
    echo "PASS: group-status terminated in ${ELAPSED}s (statement_timeout worked)"
    exit 0
fi
