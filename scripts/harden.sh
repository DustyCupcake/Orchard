#!/usr/bin/env bash
# Orchard OS hardening — run this once, as root, on a fresh Debian/Ubuntu
# VPS, before scripts/deploy.sh. Separate from deploy.sh on purpose: this
# does the one genuinely risky thing here (locking down SSH), which
# deserves its own safety gate rather than being folded into deploy.sh's
# otherwise simple, always-idempotent "bring the app up" flow.
#
# What it does, in order:
#   1. apt update/upgrade
#   2. create a non-root sudo admin user, authorize an SSH key for it,
#      and generate a sudo password for it (printed once)
#   3. [safety gate] harden sshd — key-only auth, no root login
#   4. ufw firewall — allow only SSH, 80, 443 (matches Orchard's Caddy setup)
#   5. unattended-upgrades for OS security patches
#   6. fail2ban for SSH brute-force protection
#   7. swapfile + vm.swappiness — architecture.md calls for this on a
#      small VPS; deploy.sh's own Docker/Postgres memory tuning assumes
#      it's there
#
# Deliberately does NOT install Docker or clone the app — that's
# deploy.sh's job, run afterward as the new admin user (via sudo).
#
# Usage:
#   ssh root@<vps-ip>                    # or your provider's initial login
#   curl -fsSL <raw-url-to-this-script> | bash
#   # ... follow the safety-gate instructions when they appear ...
#   # then log back in as the new admin user and run:
#   sudo ./scripts/deploy.sh
#
# Safe to re-run: each step is checkpointed in /var/lib/orchard-bootstrap
# and skipped if already done — re-run after fixing a failed step, or
# after stopping deliberately at the safety gate below.
set -euo pipefail

# ── logging ──────────────────────────────────────────────────────────────

_ts() { date '+%Y-%m-%d %H:%M:%S'; }
log_info()  { printf '[%s] [INFO ] %s\n'  "$(_ts)" "$*"; }
log_warn()  { printf '[%s] [WARN ] %s\n'  "$(_ts)" "$*" >&2; }
log_error() { printf '[%s] [ERROR] %s\n'  "$(_ts)" "$*" >&2; }
log_step()  { printf '\n[%s] === %s ===\n' "$(_ts)" "$*"; }
die() { log_error "$*"; exit 1; }

# Finds an authorized_keys file worth copying from — root's own, or (if
# running as root via `sudo -i` from a non-root sudoer) that user's. On a
# fresh VPS this usually comes up empty (password-based login first, no
# key seeded anywhere) — expected, not a bug; you paste a key by hand then.
_find_source_authorized_keys() {
  if [[ -s /root/.ssh/authorized_keys ]]; then
    echo /root/.ssh/authorized_keys
  elif [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" && -s "/home/${SUDO_USER}/.ssh/authorized_keys" ]]; then
    echo "/home/${SUDO_USER}/.ssh/authorized_keys"
  fi
}

# ── preconditions ────────────────────────────────────────────────────────

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  die "This script must be run with root privileges — run 'sudo -i' first if you logged in as a non-root sudoer."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "This script targets Debian/Ubuntu (needs apt-get)."
fi

# ── config: file, then a previous run's saved answers, then environment, ──
# ── then interactive prompts ────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/harden.conf"
CHECKPOINT_DIR="/var/lib/orchard-bootstrap"
RESOLVED_CONF="${CHECKPOINT_DIR}/harden.resolved.conf"
mkdir -p "$CHECKPOINT_DIR"

if [[ -f "$CONFIG_FILE" ]]; then
  log_info "Loading config from ${CONFIG_FILE}."
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
elif [[ -f "$RESOLVED_CONF" ]]; then
  log_info "Reusing config saved from a previous run on this box (${RESOLVED_CONF})."
  log_info "Delete that file (or put a harden.conf next to this script) if you want to be asked again."
  # shellcheck source=/dev/null
  source "$RESOLVED_CONF"
elif [[ -n "${NEW_USER:-}" && -n "${NEW_USER_PUBKEY:-}" ]]; then
  log_info "Using NEW_USER/NEW_USER_PUBKEY already set in the environment."
else
  if [[ ! -t 0 ]]; then
    die "No harden.conf, no saved config, no NEW_USER/NEW_USER_PUBKEY in the environment, and this isn't an interactive terminal — nothing to configure from."
  fi
  echo
  echo "Answering a few questions (press Enter to accept the default). This only happens once per box; your answers are saved to ${RESOLVED_CONF} for next time."
  echo

  read -r -p "Admin username to create [orchard-admin]: " NEW_USER
  NEW_USER="${NEW_USER:-orchard-admin}"

  echo "SSH public key to authorize for ${NEW_USER}."
  key_source="$(_find_source_authorized_keys)"
  if [[ -n "$key_source" ]]; then
    echo "Press Enter to reuse whatever key(s) are already in ${key_source}"
    echo "(i.e. the key you just used to log in here), or paste a specific key:"
    read -r -p "> " NEW_USER_PUBKEY
    NEW_USER_PUBKEY="${NEW_USER_PUBKEY:-COPY_FROM_ROOT}"
  else
    echo "No existing key found on this box to reuse. Paste the PUBLIC key from your own"
    echo "machine instead (e.g. run \`cat ~/.ssh/id_ed25519.pub\` locally and paste its output):"
    while true; do
      read -r -p "> " NEW_USER_PUBKEY
      [[ -n "$NEW_USER_PUBKEY" ]] && break
      echo "A key is required — there's nothing on this box to fall back to."
    done
  fi

  read -r -p "Timezone [UTC]: " TIMEZONE
  TIMEZONE="${TIMEZONE:-UTC}"

  read -r -p "Hostname (leave blank to keep as-is): " HOSTNAME || true

  read -r -p "Swap size in GB [2]: " SWAP_SIZE_GB
  SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"

  read -r -p "vm.swappiness [10]: " SWAPPINESS
  SWAPPINESS="${SWAPPINESS:-10}"

  read -r -p "SSH port [22]: " SSH_PORT
  SSH_PORT="${SSH_PORT:-22}"

  read -r -p "Add ${NEW_USER} to the docker group later, once Docker's installed? Convenient for day-to-day 'docker compose logs' etc, but root-equivalent access to this host [y/N]: " add_docker_grp
  if [[ "${add_docker_grp,,}" == "y" || "${add_docker_grp,,}" == "yes" ]]; then
    ADD_USER_TO_DOCKER_GROUP=true
  else
    ADD_USER_TO_DOCKER_GROUP=false
  fi

  echo
  log_info "Configured: user=${NEW_USER}, timezone=${TIMEZONE}, swap=${SWAP_SIZE_GB}G, swappiness=${SWAPPINESS}, ssh_port=${SSH_PORT}, docker_group=${ADD_USER_TO_DOCKER_GROUP}"
  echo
fi

: "${NEW_USER:?NEW_USER must be set}"
: "${NEW_USER_PUBKEY:?NEW_USER_PUBKEY must be set}"
: "${SWAP_SIZE_GB:=2}"
: "${SWAPPINESS:=10}"
: "${SSH_PORT:=22}"
: "${TIMEZONE:=UTC}"
: "${ADD_USER_TO_DOCKER_GROUP:=false}"

cat > "$RESOLVED_CONF" <<CONF_EOF
NEW_USER="${NEW_USER}"
NEW_USER_PUBKEY="${NEW_USER_PUBKEY}"
TIMEZONE="${TIMEZONE}"
HOSTNAME="${HOSTNAME:-}"
SWAP_SIZE_GB="${SWAP_SIZE_GB}"
SWAPPINESS="${SWAPPINESS}"
SSH_PORT="${SSH_PORT}"
ADD_USER_TO_DOCKER_GROUP="${ADD_USER_TO_DOCKER_GROUP}"
CONF_EOF
chmod 600 "$RESOLVED_CONF"

# ── interactive confirmation (used by the SSH-hardening safety gate) ───────

ASSUME_YES="${ASSUME_YES:-0}"
confirm() {
  local prompt="$1"
  if [[ "$ASSUME_YES" == "1" ]]; then
    log_warn "ASSUME_YES=1 set — auto-confirming: ${prompt}"
    return 0
  fi
  local reply
  read -r -p "${prompt} [y/N] " reply
  [[ "${reply,,}" == "y" || "${reply,,}" == "yes" ]]
}

# ── checkpointing — safe to re-run, skips whatever already succeeded ───────

CHECKPOINT_FILE="${CHECKPOINT_DIR}/checkpoints"
_ensure_checkpoint_store() { mkdir -p "$CHECKPOINT_DIR"; touch "$CHECKPOINT_FILE"; }
checkpoint_done() { _ensure_checkpoint_store; grep -qxF "$1" "$CHECKPOINT_FILE" 2>/dev/null; }
checkpoint_mark() { _ensure_checkpoint_store; checkpoint_done "$1" || echo "$1" >> "$CHECKPOINT_FILE"; }

run_once() {
  local name="$1" fn="$2"
  if checkpoint_done "$name"; then
    log_info "Skipping '${name}' — already completed on a previous run (see ${CHECKPOINT_FILE})."
    return 0
  fi
  log_step "$name"
  "$fn"
  checkpoint_mark "$name"
}

# ── small utilities ──────────────────────────────────────────────────────

apt_install() { DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"; }
reboot_required() { [[ -f /var/run/reboot-required ]]; }

LOG_FILE="/var/log/orchard-harden.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log_info "Starting Orchard OS hardening. Full log: ${LOG_FILE}"
log_info "Target admin user: ${NEW_USER}"

# ---------------------------------------------------------------------------
# 1. OS update
# ---------------------------------------------------------------------------

step_update_os() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
  DEBIAN_FRONTEND=noninteractive apt-get -y autoremove
  apt_install curl ca-certificates gnupg lsb-release

  if [[ -n "$TIMEZONE" ]]; then
    timedatectl set-timezone "$TIMEZONE" || log_warn "Could not set timezone to ${TIMEZONE} — check it's a valid tz name."
  fi
  if [[ -n "${HOSTNAME:-}" ]]; then
    hostnamectl set-hostname "$HOSTNAME" || log_warn "Could not set hostname to ${HOSTNAME}."
  fi

  if reboot_required; then
    log_warn "A reboot is required after this OS update. Recommended: let this script finish"
    log_warn "through the SSH-hardening safety gate below, confirm you can log in as ${NEW_USER},"
    log_warn "THEN reboot before running deploy.sh."
  fi
}

# ---------------------------------------------------------------------------
# 2. Non-root sudo admin user
# ---------------------------------------------------------------------------

step_create_admin_user() {
  if id "$NEW_USER" >/dev/null 2>&1; then
    log_info "User ${NEW_USER} already exists — skipping creation (and not touching its password,"
    log_info "since this script didn't just create the account)."
  else
    adduser --disabled-password --gecos "" "$NEW_USER"
    usermod -aG sudo "$NEW_USER"
    log_info "Created ${NEW_USER} and added to the sudo group."

    # SSH in is key-only (the whole point of the hardening below), but sudo
    # still authenticates against the invoking user's own Unix password,
    # and adduser --disabled-password deliberately leaves that unset.
    # Generate a strong one now and print it once — this is the ONLY
    # password this account has, and this script keeps no copy of it.
    local sudo_password
    sudo_password="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 || true)"
    [[ ${#sudo_password} -eq 24 ]] || die "Failed to generate a 24-char sudo password (got ${#sudo_password} chars) — /dev/urandom problem?"
    echo "${NEW_USER}:${sudo_password}" | chpasswd
    log_warn "Generated a sudo/login password for ${NEW_USER} — shown ONCE, right now, not saved anywhere by this script:"
    log_warn "  ${sudo_password}"
    log_warn "Save it now. If it's ever lost: the SSH key still gets you in as ${NEW_USER}, but sudo needs"
    log_warn "THIS password — recovery without it means your VPS provider's rescue console."
  fi

  local ssh_dir="/home/${NEW_USER}/.ssh"
  install -d -m 700 -o "$NEW_USER" -g "$NEW_USER" "$ssh_dir"
  local authorized_keys="${ssh_dir}/authorized_keys"

  if [[ "$NEW_USER_PUBKEY" == "COPY_FROM_ROOT" ]]; then
    local source_keys
    source_keys="$(_find_source_authorized_keys)"
    if [[ -z "$source_keys" ]]; then
      die "NEW_USER_PUBKEY=COPY_FROM_ROOT but no authorized_keys found for root or \$SUDO_USER (${SUDO_USER:-unset}). Re-run and paste an explicit key instead."
    fi
    cp "$source_keys" "$authorized_keys"
    log_info "Copied ${source_keys} to ${NEW_USER}."
  else
    if [[ ! "$NEW_USER_PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2) ]]; then
      die "NEW_USER_PUBKEY doesn't look like a valid public key (should start with ssh-ed25519, ssh-rsa, etc)."
    fi
    echo "$NEW_USER_PUBKEY" > "$authorized_keys"
    log_info "Wrote the configured public key to ${NEW_USER}'s authorized_keys."
  fi

  chmod 600 "$authorized_keys"
  chown "$NEW_USER":"$NEW_USER" "$authorized_keys"
}

# ---------------------------------------------------------------------------
# 3. SSH hardening — the one step that can lock you out if done wrong.
#    Stop and verify access from a SECOND terminal before disabling root
#    login / password auth in this one.
# ---------------------------------------------------------------------------

step_harden_ssh() {
  log_warn "Before continuing: open a NEW, SEPARATE terminal window and confirm you can:"
  log_warn "  1) ssh ${NEW_USER}@<this-vps-ip>"
  log_warn "  2) sudo -v   (enter the sudo password this script generated for ${NEW_USER} a moment ago)"
  log_warn "Do NOT close this current root session until that works."
  log_warn "If it doesn't work, fix it now (or Ctrl+C here) — do not proceed."

  if ! confirm "Confirmed ${NEW_USER} can SSH in and sudo from a separate session?"; then
    log_error "Not confirmed — stopping before touching sshd config."
    log_error "Re-run this script once you've verified access; steps already done will be skipped."
    exit 1
  fi

  local sshd_config="/etc/ssh/sshd_config"
  local drop_in_dir="/etc/ssh/sshd_config.d"
  local drop_in="${drop_in_dir}/99-orchard-hardening.conf"
  mkdir -p "$drop_in_dir"

  cat > "$drop_in" <<EOF
# Managed by scripts/harden.sh — edit here, not in sshd_config directly.
Port ${SSH_PORT}
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
EOF

  if ! grep -q "^Include ${drop_in_dir}/\*.conf" "$sshd_config" 2>/dev/null; then
    sed -i "1i Include ${drop_in_dir}/*.conf" "$sshd_config"
  fi

  sshd -t || die "sshd config failed validation (sshd -t) — NOT restarting sshd. Fix ${drop_in} and re-run."

  systemctl reload sshd
  log_info "sshd hardened and reloaded: root login disabled, password auth disabled, port ${SSH_PORT}."
  log_warn "Keep your current root session open a little longer and re-verify ${NEW_USER} access once more, just in case."
}

# ---------------------------------------------------------------------------
# 4. Firewall — same ports Orchard's own docker-compose.yml/Caddyfile need.
# ---------------------------------------------------------------------------

step_configure_firewall() {
  apt_install ufw
  ufw --force reset >/dev/null
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "${SSH_PORT}/tcp" comment "SSH"
  ufw allow 80/tcp comment "HTTP (Caddy)"
  ufw allow 443/tcp comment "HTTPS (Caddy)"
  ufw --force enable
  log_info "ufw enabled — only ${SSH_PORT}/tcp, 80/tcp, 443/tcp allowed inbound."
  ufw status verbose
}

# ---------------------------------------------------------------------------
# 5. unattended-upgrades
# ---------------------------------------------------------------------------

step_unattended_upgrades() {
  apt_install unattended-upgrades apt-listchanges

  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

  log_info "unattended-upgrades installed and enabled for security updates."
  log_warn "Review /etc/apt/apt.conf.d/50unattended-upgrades on the box if you want automatic"
  log_warn "reboots after kernel updates — left off by default, since a stray reboot on a box"
  log_warn "running Orchard live is a decision worth making deliberately."
}

# ---------------------------------------------------------------------------
# 6. fail2ban
# ---------------------------------------------------------------------------

step_fail2ban() {
  apt_install fail2ban

  cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = ${SSH_PORT}
# Read directly from the systemd journal rather than polling a log file
# (fail2ban's default "auto" backend). journald is always present on a
# systemd box; /var/log/auth.log depends on rsyslog being installed,
# which isn't guaranteed on every minimal cloud image — this avoids a
# silent "fail2ban thinks it's watching something, but isn't" failure.
backend = systemd
EOF

  systemctl enable --now fail2ban
  systemctl restart fail2ban
  log_info "fail2ban enabled, watching sshd on port ${SSH_PORT}."
}

# ---------------------------------------------------------------------------
# 7. Swap — architecture.md's own memory-budget notes call for this on a
#    1-2GB VPS, cheap insurance against an OOM kill taking the whole stack
#    down (Postgres + the Next.js app in one container each).
# ---------------------------------------------------------------------------

step_setup_swap() {
  if swapon --show | grep -q .; then
    log_info "Swap already active — skipping swapfile creation."
  else
    local swapfile="/swapfile"
    if ! fallocate -l "${SWAP_SIZE_GB}G" "$swapfile" 2>/dev/null; then
      log_warn "fallocate failed (filesystem may not support it) — falling back to dd, this is slower."
      dd if=/dev/zero of="$swapfile" bs=1M count=$((SWAP_SIZE_GB * 1024)) status=progress
    fi
    chmod 600 "$swapfile"
    mkswap "$swapfile"
    swapon "$swapfile"
    if ! grep -q "^${swapfile} " /etc/fstab; then
      echo "${swapfile} none swap sw 0 0" >> /etc/fstab
    fi
    log_info "Created and enabled ${SWAP_SIZE_GB}G swapfile at ${swapfile}."
  fi

  cat > /etc/sysctl.d/60-swappiness.conf <<EOF
vm.swappiness=${SWAPPINESS}
EOF
  sysctl -p /etc/sysctl.d/60-swappiness.conf
  log_info "vm.swappiness set to ${SWAPPINESS}."
  free -h
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

run_once "update-os"          step_update_os
run_once "create-admin-user"  step_create_admin_user
run_once "harden-ssh"         step_harden_ssh
run_once "configure-firewall" step_configure_firewall
run_once "unattended-upgrades" step_unattended_upgrades
run_once "fail2ban"           step_fail2ban
run_once "setup-swap"         step_setup_swap

log_step "Hardening complete"
log_info "Log back in as ${NEW_USER} (not root — root SSH login is now disabled) and run:"
log_info "  git clone https://github.com/DustyCupcake/Orchard.git /opt/orchard"
log_info "  cd /opt/orchard"
log_info "  sudo ./scripts/deploy.sh"
if [[ "${ADD_USER_TO_DOCKER_GROUP}" == "true" ]]; then
  log_info "(${NEW_USER} was configured to be added to the docker group once Docker's installed —"
  log_info "deploy.sh will do that as part of installing Docker.)"
fi
if reboot_required; then
  log_warn "A reboot is still pending from the OS update step. Reboot now (as ${NEW_USER}, via sudo) before deploy.sh."
fi
