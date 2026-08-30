#!/usr/bin/env bash
# scripts/rebuild.sh — redeploy only what actually changed since the last
# time this ran, instead of always paying for a full image rebuild.
#
# Hashes file content into four buckets and compares against the previous
# run's saved hashes (.rebuild-state, gitignored) — content, not git: .env
# is gitignored and edited by hand on the server, so a git-diff-based
# approach would silently miss exactly the kind of change (SMTP creds, a
# domain) that most often needs a redeploy. Runs the cheapest action that
# covers whatever changed, in order:
#   - docker-compose.yml            -> docker compose down && up -d
#     (network-level changes, e.g. a subnet, aren't reliably applied to an
#     already-existing network by a plain `up -d` — needs a real recreate)
#   - app code / Dockerfile / deps  -> docker compose build app (+ up -d)
#   - .env                          -> docker compose up -d
#     (Compose hashes resolved env_file content itself, so this alone is
#     enough to get the affected container recreated)
#   - Caddyfile                     -> caddy reload inside the container
#     (Compose does NOT detect edits to a bind-mounted file on its own —
#     this is the one case that needs an explicit trigger every time,
#     unless a down/up above already recreated caddy fresh)
#
# First run (no saved state) always does everything, since there's nothing
# to diff against yet. Safe to run any time — a no-op if nothing changed.
#
# Usage: ./scripts/rebuild.sh
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }

STATE_FILE=".rebuild-state"

IMAGE_PATHS=(Dockerfile package.json package-lock.json docker-entrypoint.sh next.config.ts next.config.js next.config.mjs tsconfig.json src drizzle public scripts/migrate.mjs scripts/seed.ts)
COMPOSE_PATHS=(docker-compose.yml)
ENV_PATHS=(.env)
CADDY_PATHS=(Caddyfile)

# Order-independent content hash across whichever of the given paths
# actually exist (files or directories, recursed).
hash_paths() {
  local existing=()
  for p in "$@"; do
    [ -e "$p" ] && existing+=("$p")
  done
  if [ ${#existing[@]} -eq 0 ]; then
    printf 'none'
    return
  fi
  find "${existing[@]}" -type f -print0 2>/dev/null | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
}

prev_image=""
prev_compose=""
prev_env=""
prev_caddy=""
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
else
  log "No previous rebuild state found — first run, doing everything."
fi

new_image="$(hash_paths "${IMAGE_PATHS[@]}")"
new_compose="$(hash_paths "${COMPOSE_PATHS[@]}")"
new_env="$(hash_paths "${ENV_PATHS[@]}")"
new_caddy="$(hash_paths "${CADDY_PATHS[@]}")"

image_changed=false
compose_changed=false
env_changed=false
caddy_changed=false
[ "$new_image" != "$prev_image" ] && image_changed=true
[ "$new_compose" != "$prev_compose" ] && compose_changed=true
[ "$new_env" != "$prev_env" ] && env_changed=true
[ "$new_caddy" != "$prev_caddy" ] && caddy_changed=true

did_something=false

if [ "$image_changed" = true ]; then
  log "App code / Dockerfile / package.json changed — building the image..."
  docker compose build app
  did_something=true
fi

if [ "$compose_changed" = true ]; then
  log "docker-compose.yml changed — recreating the stack (down/up, needed for network-level changes)..."
  docker compose down
  docker compose up -d
  did_something=true
elif [ "$image_changed" = true ] || [ "$env_changed" = true ]; then
  log "Applying changes..."
  docker compose up -d
  did_something=true
fi

if [ "$caddy_changed" = true ] && [ "$compose_changed" = false ]; then
  log "Caddyfile changed — reloading Caddy's config..."
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
  did_something=true
fi

if [ "$did_something" = false ]; then
  log "Nothing changed since the last rebuild — nothing to do."
fi

cat > "$STATE_FILE" <<EOF
prev_image="${new_image}"
prev_compose="${new_compose}"
prev_env="${new_env}"
prev_caddy="${new_caddy}"
EOF

log "Done."
