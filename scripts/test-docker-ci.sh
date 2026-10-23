#!/usr/bin/env bash
set -euo pipefail

COMPOSE=(docker compose -f docker-compose.test.yml)

run_unit() {
  local node_version="$1"
  "${COMPOSE[@]}" build --build-arg "NODE_VERSION=${node_version}" test-unit
  "${COMPOSE[@]}" run --rm test-unit
}

run_unit 20
run_unit 22

"${COMPOSE[@]}" build test-integration
"${COMPOSE[@]}" run --rm test-integration

node esbuild.bundle.mjs
npx vitest run --config vitest.bundle.config.ts
