#!/usr/bin/env bash
# scripts/test.sh — the test protocol, in one command, with no per-run setup.
#
# The suite runs INSIDE a node:22 container — the same base image the
# Dockerfile builds production on — against a Postgres in a container of
# its own. That is the whole point of this script: a test run used to
# happen on whatever Node the developer happened to have installed, so
# `npm test` was verifying a different runtime than the one that ships.
# The gap was concrete, not theoretical: the host ran Node 23 while the
# `checks` stage (lint + tsc) and the production runtime both ran Node
# 22, so lint and types were checked on one version and the suite
# silently ran on another. Pinning the runner is what removes the guess.
#
# Two containers, one command, nothing for a new machine to set up.
#
# Memory: the suite truncates between files (tests/helpers.ts), and a
# long-lived Postgres grows steadily for the length of a run — measured
# at ~11MB per test file (35MB -> 261MB over 20 files). The growth does
# NOT fall back between files or between separate vitest invocations; it
# accumulates in the server, which is doing 36k+ transactions against a
# ~20MB database. An uninterrupted 88-file run reached ~3.2GB, which is
# invisible on a large VM and a hard OOM on a small one. So files run in
# batches and the database is restarted when it crosses a budget read
# from the VM's actual allocation. `docker restart` returns ~3.2GB to
# ~24MB in about a second, and the migrated schema survives in a volume.
#
# Not a production concern: production never truncates, and its memory is
# already capped by the deployed shared_buffers / max_connections.
#
# Usage:
#   npm test                                   # every test file
#   ./scripts/test.sh tests/coordination.test.ts
#   ORCHARD_TEST_NODE_IMAGE=node:22-bookworm-slim ./scripts/test.sh
#   ORCHARD_TEST_HOST=1 ./scripts/test.sh      # run on the host instead
#
# Environment overrides (all optional):
#   ORCHARD_TEST_BUDGET_MB   memory ceiling before restarting the database
#   ORCHARD_TEST_BATCH       files per batch
#   ORCHARD_TEST_CONTAINER   test database container name
#   ORCHARD_TEST_PORT        host port the test database is published on
#   ORCHARD_TEST_NODE_IMAGE  runner image (must match the Dockerfile's base)
#   ORCHARD_TEST_HOST=1      bypass the container and use local Node
#
# Exits nonzero if any batch fails, so it drops straight into CI.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONTAINER="${ORCHARD_TEST_CONTAINER:-orchard-test-pg}"
PORT="${ORCHARD_TEST_PORT:-5433}"
DB_USER="orchard"
DB_PASS="test"
DB_NAME="orchard"
NODE_IMAGE="${ORCHARD_TEST_NODE_IMAGE:-node:22-bookworm-slim}"
BATCH="${ORCHARD_TEST_BATCH:-15}"
REPO="$PWD"

# Host-side URL, for anything running outside the runner container
# (migrate, the health check).
HOST_DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@localhost:${PORT}/${DB_NAME}"
# Container-side URL. The database publishes to the host, and Docker
# Desktop maps host.docker.internal onto the host, so the runner reaches
# it the same way any other container would — no extra docker network to
# create, clean up, or leave behind.
RUNNER_DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@host.docker.internal:${PORT}/${DB_NAME}"
# Required even by suites that never touch auth: anything using the
# generic action-token infrastructure throws without it (vitest.config.ts).
SECRET="${SESSION_SECRET:-test-secret-not-for-production-1234567890abcdef}"

# Named volumes so the Linux dependency tree (which cannot be shared with
# the host's macOS one — @esbuild is a per-platform binary) is installed
# once and reused. The lock file's hash decides whether it is still valid.
DEPS_VOLUME="${CONTAINER}_node_modules"
META_VOLUME="${CONTAINER}_meta"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

mem_mb() {
  # Container memory in whole MB, read from `docker stats` and not from
  # the cgroup files: stats is namespaced per container, whereas
  # /proc/slabinfo read inside a container is VM-wide and reports the
  # host's totals — which is how an earlier diagnosis came to blame the
  # kernel dentry cache for memory it had nothing to do with.
  #
  # MemUsage looks like "68.05MiB / 1.924GiB". Take the used side and
  # normalise: once a container passes ~1GB the reading crosses into GiB,
  # and a parser that only understood MiB would call it idle at exactly
  # the moment it mattered.
  docker stats --no-stream --format '{{.MemUsage}}' "$CONTAINER" 2>/dev/null \
    | awk -F'/' '{print $1}' \
    | awk '{
        v = $1 + 0
        if ($0 ~ /GiB/) v *= 1024
        if ($0 ~ /KiB/) v /= 1024
        printf "%d", v + 0.5
      }'
}

wait_ready() {
  for _ in $(seq 1 30); do
    docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

ensure_container() {
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    return 0
  fi
  log "Test database not running — creating it (--rm containers do not survive a Docker restart)"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # The two settings the production stack runs with (docker-compose.yml).
  # This database used to start on stock Postgres defaults, so a suite
  # could pass locally and still break on the deployed configuration.
  docker run --rm -d -p "${PORT}:5432" \
    -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB="$DB_NAME" \
    --name "$CONTAINER" postgres:16-alpine \
    -c shared_buffers=128MB -c max_connections=50 >/dev/null
  wait_ready || die "test database did not become ready"
}

migrate() {
  log "Migrating (idempotent — a no-op once the schema is current)"
  DATABASE_URL="$HOST_DATABASE_URL" node scripts/migrate.mjs >/dev/null
}

restart_db() {
  docker restart "$CONTAINER" >/dev/null
  wait_ready
}

ensure_runner_deps() {
  # The lock file's content, not its mtime: an mtime check re-installs
  # after a git checkout that hasn't changed dependencies at all, which is
  # the common case and would make every branch switch pay a full install.
  local want have
  want=$(shasum -a 256 package-lock.json 2>/dev/null | awk '{print $1}' \
    || sha256sum package-lock.json | awk '{print $1}')
  have=$(docker run --rm -v "$META_VOLUME:/meta" "$NODE_IMAGE" \
    cat /meta/lock-hash 2>/dev/null || true)

  if [ "$want" = "$have" ] && [ -n "$want" ]; then
    return 0
  fi
  log "Installing dependencies into the runner container (Linux tree, keyed on package-lock.json)"
  docker run --rm \
    -v "$REPO:/app" \
    -v "$DEPS_VOLUME:/app/node_modules" \
    -v "$META_VOLUME:/meta" \
    -v "${CONTAINER}_npm:/root/.npm" \
    -w /app "$NODE_IMAGE" \
    bash -c "npm ci --no-audit --no-fund >/dev/null 2>&1 && printf '%s' '$want' > /meta/lock-hash" \
    || die "npm ci failed inside the runner container"
}

run_vitest() {
  if [ "${ORCHARD_TEST_HOST:-0}" = "1" ]; then
    DATABASE_URL="$HOST_DATABASE_URL" SESSION_SECRET="$SECRET" npx vitest run "$@"
    return
  fi
  docker run --rm \
    -v "$REPO:/app" \
    -v "$DEPS_VOLUME:/app/node_modules" \
    -w /app \
    -e DATABASE_URL="$RUNNER_DATABASE_URL" \
    -e SESSION_SECRET="$SECRET" \
    -e CI=true \
    "$NODE_IMAGE" \
    npx vitest run "$@"
}

# Budget: the smaller of an explicit override and a quarter of what the
# VM actually has. Measured growth is ~11MB per file, so this leaves
# room for the app stack to be running alongside.
if [ -n "${ORCHARD_TEST_BUDGET_MB:-}" ]; then
  BUDGET_MB="$ORCHARD_TEST_BUDGET_MB"
else
  vm_mb=$(docker info --format '{{.MemTotal}}' 2>/dev/null | awk '{printf "%d", $1/1048576}')
  [ -n "$vm_mb" ] || vm_mb=2048
  BUDGET_MB=$(( vm_mb / 4 ))
  [ "$BUDGET_MB" -gt 1024 ] && BUDGET_MB=1024
  [ "$BUDGET_MB" -lt 256 ] && BUDGET_MB=256
fi

if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  # No `mapfile` — macOS ships bash 3.2 as /bin/bash, which lacks it.
  FILES=()
  while IFS= read -r line; do
    FILES+=("$line")
  done < <(ls tests/*.test.ts | sort)
fi

ensure_container
migrate
if [ "${ORCHARD_TEST_HOST:-0}" = "1" ]; then
  log "Running on the host (ORCHARD_TEST_HOST=1) — this is NOT the deployed Node version"
else
  ensure_runner_deps
fi

where="runner container ($NODE_IMAGE)"
[ "${ORCHARD_TEST_HOST:-0}" = "1" ] && where="host ($(node --version 2>/dev/null || echo unknown))"
log "Running ${#FILES[@]} test file(s) in batches of ${BATCH} on the $where"
log "Memory budget: ${BUDGET_MB}MB (VM has ${vm_mb:-unknown}MB)"

batch_num=0
failures=0
i=0
while [ "$i" -lt "${#FILES[@]}" ]; do
  batch_num=$(( batch_num + 1 ))
  batch=("${FILES[@]:i:BATCH}")
  i=$(( i + BATCH ))

  before=$(mem_mb)
  if [ "$before" -gt "$BUDGET_MB" ]; then
    log "Batch ${batch_num}: database at ${before}MB is over budget — restarting to reclaim"
    restart_db || die "could not restart $CONTAINER"
  fi

  printf '\n\033[1m--- batch %d: %d file(s) ---\033[0m\n' "$batch_num" "${#batch[@]}"
  if ! run_vitest "${batch[@]}"; then
    failures=$(( failures + 1 ))
    printf '\n\033[1;31m--- batch %d FAILED ---\033[0m\n' "$batch_num"
  fi

  after=$(mem_mb)
  printf '\033[2m    database memory: %sMB (budget %sMB)\033[0m\n' "$after" "$BUDGET_MB"
done

printf '\n'
if [ "$failures" -gt 0 ]; then
  printf '\033[1;31m%s of %s batch(es) failed.\033[0m\n' "$failures" "$batch_num"
  exit 1
fi
log "All ${batch_num} batch(es) passed."
