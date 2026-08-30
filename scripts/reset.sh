#!/usr/bin/env bash
# scripts/reset.sh — unconditionally redeploy some or all of the stack,
# bypassing rebuild.sh's change-detection entirely. For when something's
# stale or acting wrong and you want to start a piece over from scratch
# rather than trust incremental state (rebuild.sh's hashes, Docker's layer
# cache, the BuildKit cache mounts in the Dockerfile).
#
# Never touches data — no flag here drops the pgdata/uploads/caddy_data
# volumes (in particular, caddy_data holds the Let's Encrypt certificate;
# losing it means going through issuance again). This script is only about
# redeploying containers/images fresh, not about data — a `--wipe-db` or
# similar is a deliberately separate, far more dangerous operation this
# script doesn't do.
#
# Usage:
#   ./scripts/reset.sh                # everything (same as --all): full
#                                      # no-cache rebuild + down + up
#   ./scripts/reset.sh --app          # rebuild the app image from scratch
#                                      # (--no-cache) and recreate it
#   ./scripts/reset.sh --caddy        # force-recreate the caddy container
#   ./scripts/reset.sh --db           # force-recreate the postgres
#                                      # container (data volume untouched)
#   ./scripts/reset.sh --app --caddy  # combine flags freely
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

is_all=false
[ "$#" -eq 0 ] && is_all=true
for arg in "$@"; do
  [ "$arg" = "--all" ] && is_all=true
done

if [ "$is_all" = true ]; then
  log "Full reset: rebuilding the app image from scratch and recreating the whole stack..."
  docker compose build --no-cache app
  docker compose down
  docker compose up -d
else
  for arg in "$@"; do
    case "$arg" in
      --app)
        log "Rebuilding the app image from scratch (--no-cache) and recreating it..."
        docker compose build --no-cache app
        docker compose up -d --force-recreate app
        ;;
      --caddy)
        log "Force-recreating the caddy container..."
        docker compose up -d --force-recreate caddy
        ;;
      --db)
        log "Force-recreating the postgres container (data volume untouched)..."
        docker compose up -d --force-recreate postgres
        ;;
      *)
        die "Unknown argument: $arg (expected --all, --app, --caddy, --db)"
        ;;
    esac
  done
fi

# Whatever rebuild.sh thought was "current" no longer matches what's
# actually deployed — clear it so the next run recomputes fresh instead of
# comparing against pre-reset state.
rm -f .rebuild-state

log "Done."
