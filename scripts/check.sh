#!/usr/bin/env bash
# scripts/check.sh — the one command that runs what CI runs.
#
#   ./scripts/check.sh                          # everything
#   ./scripts/check.sh tests/cycles.test.ts     # checks + a test subset
#
# CI gates a pull request on two independent things, and until this script
# existed there was no single local command that reproduced either of them:
#
#   1. the `checks` Docker stage — `npm run lint` then `npx tsc --noEmit`
#   2. the test suite, via scripts/test.sh
#
# CONTRIBUTING.md documented only (2). So the only way to find out a change
# didn't lint was to push and let CI say so — and the obvious thing to reach
# for, `npm run lint`, is the one that fails most confusingly. It runs
# eslint from the *host's* node_modules, so a host whose tree predates a
# dependency bump gets whatever that tree has. When Next 15 → 16 landed,
# that meant eslint-config-next 15.5.27 against a config written for 16, and
# the failure was `Cannot find module '.../eslint-config-next/core-web-vitals'`
# — which reads as a broken eslint.config.mjs and invites editing a correct
# file. It is not one; the repo is fine and this stage is what proves it.
#
# Both halves run against package-lock.json rather than the host's tree, which
# is the entire point:
#
#   - the checks stage does its own `npm ci` in the image
#   - scripts/test.sh keeps its own Linux node_modules in a volume, keyed by
#     the package-lock hash, and reinstalls when that hash changes
#
# So a stale host tree can make this pass, and can never make it lie. That is
# also why the two halves are separate containers rather than one `npm test`
# with lint bolted on: test.sh's whole design is about a specific resource
# budget against a real Postgres, and folding an unrelated Docker build into
# it would obscure what actually failed.
#
# `--output=type=cacheonly` is scripts/rebuild.sh's own spelling of the same
# stage and the same one CI's build-push-action runs with `push: false`: the
# stage executes for its exit code and no image is kept.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is required — both halves of this run in containers"

log "Lint + typecheck (the CI \`checks\` stage, against package-lock.json)"
# Not `npm run lint`: that resolves eslint from the host tree, which is the
# failure this script exists to route around.
docker buildx build --target checks --output=type=cacheonly . \
  || die "lint or typecheck failed — see above; this is the same stage CI runs"

log "Tests"
./scripts/test.sh "$@"