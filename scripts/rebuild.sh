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
#   - app code / Dockerfile / deps  -> docker compose pull app (+ up -d),
#     pinned to this exact commit's tag rather than :latest — see
#     ORCHARD_IMAGE_TAG below. Built off-box by
#     .github/workflows/docker-build.yml; docker-compose.yml's own
#     `build:` block is still there as a manual local-build fallback,
#     reachable via `--build` (or ORCHARD_BUILD_LOCAL=1) — which is what a
#     development machine wants. See the usage note below for why the two
#     hosts don't share a default.
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
# Usage: ./scripts/rebuild.sh [--build | --pull]
#
#   --build   build the image on this machine (the default is --pull)
#   --pull    pull the image CI built for HEAD from the registry
#
# WHY BOTH, since the default is still --pull: the two hosts have
# genuinely different constraints and the script grew only one answer.
#
# The production VPS pulls. It is small (1-2GB RAM) and building there is
# what produced the "Ineffective mark-compacts near heap limit" OOM and the
# "no space left on device" that moved the build to GitHub Actions
# (03ce132). Pulling is the whole point of that change and must stay the
# default for it.
#
# A development machine should not have to be. A dev box has the RAM to
# build, and — this is the part that actually broke the loop — a pull can
# only ever deploy a commit that CI has already finished building. Working
# tree changes, which is what a session produces, are therefore
# undeployable: you'd have to commit, push, wait for Actions, and pull,
# every time you wanted to look at your own work in a browser. That is how
# a run of changes ended up "verified by tsc and eslint, not verified in a
# browser" when the browser was sitting right there on localhost:3000.
#
# So `--build` builds here and tags the result with HEAD, the same tag CI
# would have used, and `up -d` picks it up. Nothing about the VPS path
# changes.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }

# Flag > env > default(pull). The env var is what a dev box puts in its own
# shell, so `rebuild.sh` on its own does the right thing there.
BUILD_LOCAL="${ORCHARD_BUILD_LOCAL:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD_LOCAL=1 ;;
    --pull)  BUILD_LOCAL=0 ;;
    -h|--help)
      sed -n '31,58p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die() { printf 'ERROR: unknown option %s\n' "$1" >&2; exit 1; }; die ;;
  esac
  shift
done

# Pin every docker compose invocation below to the image for exactly the
# commit checked out here — never a floating :latest. On the pull path that
# means "the image CI built for this commit", and deploying before Actions
# has finished fails loudly ("manifest not found") rather than silently
# redeploying the previous commit. On the build path the tag is what the
# local build gets, so both paths converge on one name for one commit.
export ORCHARD_IMAGE_TAG="$(git rev-parse HEAD)"

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
  if [ "$BUILD_LOCAL" = "1" ]; then
    # The `checks` stage first, because the runner target doesn't depend on
    # it — `next build` is set to skip lint and tsc (next.config.ts sets
    # eslint.ignoreDuringBuilds and typescript.ignoreBuildErrors), so without
    # this a type error would only surface at the very end of a long build
    # rather than in a minute. This is what the Dockerfile's own comment on
    # the stage describes, and what the pre-03ce132 version of this script
    # did before the build moved off-box.
    #
    # `docker buildx build`, not `docker compose build --target`: Compose v5
    # has no --target flag on `build`, while buildx does, and the CI
    # workflow already builds this exact stage the same way. cacheonly means
    # the stage's image is discarded and only its exit code is wanted.
    log "Running lint + tsc in a container first (fast fail before the real build)..."
    docker buildx build --target checks --output=type=cacheonly .
    log "Building the image on this machine for commit ${ORCHARD_IMAGE_TAG:0:12}..."
    docker compose build app
  else
    log "App code / Dockerfile / package.json changed — pulling the image CI built for commit ${ORCHARD_IMAGE_TAG:0:12}..."
    docker compose pull app
  fi
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

if [ "$image_changed" = true ] && [ "$BUILD_LOCAL" != "1" ]; then
  # Each pull fetches a new commit-SHA-tagged image; Compose never drops the
  # previous one on its own. On a disk this small, that accumulation is
  # exactly the kind of slow-motion refill that caused the "no space left on
  # device" — prune anything no longer referenced now that up -d (above) has
  # switched the running container onto the new image.
  #
  # Deliberately not on the build path. That prune was written for a
  # production box where an unreferenced image per deploy is a slow disk
  # leak; a dev box builds constantly, and `-a` would throw away every other
  # local image and the base layers the next build would otherwise reuse,
  # which is a slow machine rather than a slow leak.
  docker image prune -af
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
