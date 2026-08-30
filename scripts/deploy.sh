#!/usr/bin/env bash
# Orchard deploy script — Debian/Ubuntu VPS, fresh or existing.
#
# On a genuinely fresh VPS, run scripts/harden.sh first (as root) — it
# creates a non-root admin user and locks down SSH/firewall/fail2ban/swap.
# This script deliberately doesn't do any of that itself; see harden.sh's
# own header for why they're kept separate.
#
# What it does:
#   1. Installs Docker Engine + Compose plugin, if not already present
#      (plus the docker-group membership and IPv6 networking follow-up
#      steps below, if harden.sh ran first).
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

# If scripts/harden.sh ran on this box first and its admin user opted in,
# add them to the docker group now that Docker actually exists (harden.sh
# runs before Docker is installed, so it can only record the choice).
HARDEN_CONF="/var/lib/orchard-bootstrap/harden.resolved.conf"
if [ -f "$HARDEN_CONF" ]; then
  # shellcheck disable=SC1090
  . "$HARDEN_CONF"
  if [ "${ADD_USER_TO_DOCKER_GROUP:-false}" = "true" ] && [ -n "${NEW_USER:-}" ]; then
    if id "$NEW_USER" >/dev/null 2>&1 && ! id -nG "$NEW_USER" | grep -qw docker; then
      usermod -aG docker "$NEW_USER"
      log "Added ${NEW_USER} to the docker group (as requested during hardening) — log out and back in for it to take effect."
    fi
  fi
fi

# Outbound IPv6 for containers' own connections (Caddy reaching Let's
# Encrypt, the app reaching an SMTP relay) — not the same thing as inbound
# traffic to published ports, which already works over IPv6 by default.
# Without this, a container on a v6-only VPS can't reach anything that
# only resolves to an IPv4 address. Only affects Docker networks created
# from now on — harmless and idempotent to run every time.
DAEMON_JSON="/etc/docker/daemon.json"
if ! grep -q '"ipv6"[[:space:]]*:[[:space:]]*true' "$DAEMON_JSON" 2>/dev/null; then
  if [ -s "$DAEMON_JSON" ]; then
    log "Existing ${DAEMON_JSON} found — merging in IPv6 networking (needed for containers to reach anything at all on an IPv6-only VPS)..."
    command -v jq >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq jq; }
    tmp_daemon_json="$(mktemp)"
    jq '.ipv6 = true | ."fixed-cidr-v6" = (."fixed-cidr-v6" // "fd00:dead:beef::/48") | .ip6tables = true' \
      "$DAEMON_JSON" > "$tmp_daemon_json" && mv "$tmp_daemon_json" "$DAEMON_JSON"
  else
    log "Enabling Docker IPv6 networking (harmless on a dual-stack box, needed on an IPv6-only one)..."
    cat > "$DAEMON_JSON" <<'EOF'
{
  "ipv6": true,
  "fixed-cidr-v6": "fd00:dead:beef::/48",
  "ip6tables": true
}
EOF
  fi
  systemctl restart docker
  sleep 2
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

# A handful of VPS marketplace images ship with Apache (or nginx) pre-
# installed and already listening on 80/443. Caddy needs both free — port 80
# for the ACME HTTP-01 challenge, 443 to actually serve — and fails
# certificate issuance with no error that obviously points back at Apache.
# Only flag a real conflict: something other than Docker's own proxy already
# bound to one of these ports.
if command -v ss >/dev/null 2>&1; then
  for port in 80 443; do
    listener="$(ss -ltnp "sport = :${port}" 2>/dev/null | awk -F'"' '/LISTEN/{print $2; exit}')"
    if [ -n "$listener" ] && [ "$listener" != "docker-proxy" ]; then
      warn "Port ${port} is already in use by '${listener}', not Docker — Caddy won't be able to bind it, and HTTPS issuance will fail."
      warn "If it's a preinstalled web server you don't need, disable it first, e.g.: systemctl disable --now apache2"
    fi
  done
fi

# ---------------------------------------------------------------------------
# 4. Build and start
# ---------------------------------------------------------------------------

# `next build` is memory-hungry and can exceed a small VPS's physical RAM
# on its own — harden.sh provisions swap for exactly this, but this script
# can also run standalone (see header), so check directly rather than
# assuming harden.sh ran. Warn instead of letting `docker compose build`
# OOM partway through with a cryptic V8 crash.
if ! swapon --show 2>/dev/null | grep -q .; then
  total_mem_mb="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "$total_mem_mb" -gt 0 ] && [ "$total_mem_mb" -lt 2048 ]; then
    warn "No swap active and only ${total_mem_mb}MB RAM detected — the build below may run out of memory."
    warn "Consider Ctrl-C, then either run scripts/harden.sh first (it provisions swap) or add one manually:"
    warn "  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  fi
fi

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
