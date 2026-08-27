#!/usr/bin/env bash
# Orchard deploy script — Debian/Ubuntu VPS, fresh or existing.
#
# What it does:
#   1. Installs Docker Engine + Compose plugin, if not already present.
#   2. Clones this repo (if not already run from inside a checkout).
#   3. Creates .env from .env.example on first run, generating random
#      secrets, and prompts for the values it can't guess (domain, email).
#   4. Builds the app image and brings the stack up with `docker compose`.
#   5. Opens the firewall for SSH/HTTP/HTTPS, if ufw is present.
#   6. Waits for the health check to pass and prints the result.
#
# Safe to re-run: every step is idempotent. Re-running after a `git pull`
# rebuilds the image and restarts the stack without touching your data
# volumes or overwriting an existing .env.
#
# Usage:
#   On a fresh box:   curl -fsSL <raw-url-to-this-script> | bash
#   From a checkout:  ./scripts/deploy.sh
set -euo pipefail

REPO_URL="${ORCHARD_REPO_URL:-https://github.com/DustyCupcake/Orchard.git}"
INSTALL_DIR="${ORCHARD_INSTALL_DIR:-/opt/orchard}"

log()  { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!! \033[0m%s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Sanity checks
# ---------------------------------------------------------------------------

if [ "$(id -u)" -ne 0 ]; then
  die "This script needs root (it installs packages and configures the firewall). Try: sudo ./scripts/deploy.sh"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "This script targets Debian/Ubuntu (needs apt-get). Your system doesn't have it."
fi

# ---------------------------------------------------------------------------
# 1. Docker
# ---------------------------------------------------------------------------

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Docker + Compose plugin already installed, skipping."
else
  log "Installing Docker Engine and the Compose plugin..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# ---------------------------------------------------------------------------
# 2. Get the repo onto disk
# ---------------------------------------------------------------------------

if [ -f "./docker-compose.yml" ] && [ -f "./Dockerfile" ]; then
  # Already running from inside a checkout.
  PROJECT_DIR="$(pwd)"
  log "Running from existing checkout at $PROJECT_DIR."
else
  if ! command -v git >/dev/null 2>&1; then
    log "Installing git..."
    apt-get update -qq && apt-get install -y -qq git
  fi

  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Found existing checkout at $INSTALL_DIR, pulling latest..."
    git -C "$INSTALL_DIR" pull --ff-only
  else
    log "Cloning $REPO_URL into $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  PROJECT_DIR="$INSTALL_DIR"
fi

cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# 3. .env
# ---------------------------------------------------------------------------

if [ -f ".env" ]; then
  log ".env already exists, leaving it alone."
else
  log "Creating .env..."
  cp .env.example .env

  read -rp "Domain this will be served on (e.g. orchard.example.org, or this server's IP for now): " domain
  read -rp "Email for Let's Encrypt / TLS notices: " domain_email

  gen_secret() { openssl rand -base64 32 | tr -d '\n'; }
  pg_password="$(gen_secret)"
  session_secret="$(gen_secret)"

  # Portable in-place sed (works on both GNU and BSD sed).
  sedi() { sed -i.bak "$1" .env && rm -f .env.bak; }

  sedi "s#^DOMAIN=.*#DOMAIN=${domain}#"
  sedi "s#^DOMAIN_EMAIL=.*#DOMAIN_EMAIL=${domain_email}#"
  sedi "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${pg_password}#"
  sedi "s#^SESSION_SECRET=.*#SESSION_SECRET=${session_secret}#"

  warn "Generated random Postgres and session secrets in .env."
  warn "SMTP_* is still blank — edit .env with real SMTP credentials before relying on email (magic-link login, notifications)."
fi

# shellcheck disable=SC1091
set -a; source .env; set +a
[ -n "${DOMAIN:-}" ] || die "DOMAIN is not set in .env."

# ---------------------------------------------------------------------------
# 4. Build and start
# ---------------------------------------------------------------------------

log "Building the app image..."
docker compose build

log "Starting the stack..."
docker compose up -d

# ---------------------------------------------------------------------------
# 5. Firewall (best-effort, only touches ufw if it's already in use)
# ---------------------------------------------------------------------------

if command -v ufw >/dev/null 2>&1; then
  log "Configuring ufw (allowing SSH, HTTP, HTTPS)..."
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  if ! ufw status | grep -q "Status: active"; then
    warn "ufw is installed but inactive. Not enabling it automatically — review 'ufw status' and 'ufw enable' yourself once you've confirmed SSH access is allowed."
  fi
else
  warn "ufw not found, skipping firewall setup. Make sure ports 80/443 (and SSH) are reachable through whatever firewall this box uses."
fi

# ---------------------------------------------------------------------------
# 6. Wait for health check
# ---------------------------------------------------------------------------

log "Waiting for the app to come up..."
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://localhost:3000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    log "Health check passed."
    echo
    echo "Orchard is up. Once DNS for ${DOMAIN} points at this server, it'll be live at:"
    echo "  https://${DOMAIN}"
    echo
    echo "Useful commands (from ${PROJECT_DIR}):"
    echo "  docker compose logs -f app     # tail app logs"
    echo "  docker compose ps              # container status"
    echo "  docker compose down            # stop the stack (data persists)"
    exit 0
  fi
  sleep 2
done

warn "App didn't pass its health check within 60s. Check logs with: docker compose logs app"
exit 1
