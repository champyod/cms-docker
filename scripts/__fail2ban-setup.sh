#!/usr/bin/env bash
# scripts/__fail2ban-setup.sh — fail2ban jail management for nginx.
#
# Checks jail config exists and log paths are writable, then optionally
# deploys the config to /etc/fail2ban/jail.d/ with sudo.
#
# Usage:
#   __fail2ban-setup.sh --check    verify config + log paths (dry-run)
#   __fail2ban-setup.sh --apply    copy jail config to /etc/fail2ban/jail.d/
#
# Notes:
#   CAPTCHA (if enabled) shows after 3 failed logins per IP+user within 15m and
#   reduces automated brute-force before fail2ban acts. fail2ban jail still
#   bans after 5 fails regardless (nginx-http-auth maxretry=5). Keep CAPTCHA
#   optional via CAPTCHA_ENABLED=0 by default so prod stays off unless enabled.

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# lib/common.sh
# ---------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/__lib/common.sh"
else
  log_info()  { printf '[INFO] %s\n' "$*"; }
  log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
  log_die()   { printf '[FAIL] %s\n' "${1:-fatal error}" >&2; exit "${2:-1}"; }
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
JAIL_SOURCE="${REPO_ROOT}/config/fail2ban/jail.d/grader.conf"
JAIL_DEST="/etc/fail2ban/jail.d/grader.conf"
LOG_PATHS=("/var/log/nginx" "/var/log")

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: __fail2ban-setup.sh <mode>

Modes:
  --check    Verify jail config exists and log paths are writable (dry-run)
  --apply    Copy jail config to /etc/fail2ban/jail.d/ (requires sudo)

Jails:
  nginx-http-auth   maxretry=5 bantime=1800 findtime=300
  nginx-limit-req   maxretry=10 bantime=300 findtime=300

Log paths: /var/log/nginx/*error*.log (inside nginx-logs volume)

The config source is at config/fail2ban/jail.d/grader.conf.
Deployed to /etc/fail2ban/jail.d/grader.conf on the host.

CAPTCHA (optional): When CAPTCHA_ENABLED=1, admin login shows a
Turnstile/hCaptcha widget on the 4th attempt within 15m per IP+user
(CAPTCHA_THRESHOLD=3). The widget is provider-switchable via
CAPTCHA_PROVIDER and disabled by default if keys are missing.
fail2ban still bans after 5 fails (CAPTCHA_BAN_THRESHOLD=5) regardless;
CAPTCHA merely slows automated attempts before the ban.
EOF
}

# ---------------------------------------------------------------------------
# Check subcommand
# ---------------------------------------------------------------------------
cmd_check() {
  log_info "fail2ban check mode (dry-run)"
  echo ""

  local ok=1

  # Check source config exists
  printf '  %-40s' "Jail config source:"
  if [[ -f "$JAIL_SOURCE" ]]; then
    printf 'EXISTS (%s)\n' "$JAIL_SOURCE"
  else
    printf 'MISSING\n'
    ok=0
  fi

  # Check jail config syntax (basic validation)
  printf '  %-40s' "Jail config syntax:"
  if [[ -f "$JAIL_SOURCE" ]]; then
    if grep -q '\[nginx-http-auth\]' "$JAIL_SOURCE" && grep -q '\[nginx-limit-req\]' "$JAIL_SOURCE"; then
      printf 'OK (2 jails defined)\n'
    else
      printf 'WARN (missing expected jail sections)\n'
      ok=0
    fi
  else
    printf 'SKIP (no config)\n'
  fi

  # Check fail2ban is installed
  printf '  %-40s' "fail2ban installed:"
  if command -v fail2ban-client >/dev/null 2>&1; then
    local version
    version="$(fail2ban-client --version 2>/dev/null | head -1 || echo 'unknown')"
    printf 'YES (%s)\n' "$version"
  else
    printf 'NO (fail2ban-client not in PATH)\n'
    ok=0
  fi

  # Check log paths are writable
  for log_path in "${LOG_PATHS[@]}"; do
    printf '  %-40s' "Log path $log_path:"
    if [[ -d "$log_path" ]]; then
      if [[ -w "$log_path" ]] || [[ -O "$log_path" ]]; then
        printf 'WRITABLE\n'
      else
        printf 'EXISTS (not writable by current user — sudo may be needed)\n'
      fi
    else
      printf 'NOT FOUND (will be created by nginx container)\n'
    fi
  done

  # Check destination directory
  printf '  %-40s' "Target dir /etc/fail2ban/jail.d/:"
  if [[ -d "/etc/fail2ban/jail.d" ]]; then
    printf 'EXISTS\n'
  else
    printf 'NOT FOUND (will be created on --apply)\n'
  fi

  # Check if jail already deployed
  printf '  %-40s' "Deployed jail config:"
  if [[ -f "$JAIL_DEST" ]]; then
    printf 'EXISTS\n'
  else
    printf 'NOT DEPLOYED\n'
  fi

  echo ""
  if [[ "$ok" -eq 1 ]]; then
    log_info "All checks passed — ready to --apply"
  else
    log_warn "Some checks failed — review above output"
  fi
}

# ---------------------------------------------------------------------------
# Apply subcommand
# ---------------------------------------------------------------------------
cmd_apply() {
  log_info "fail2ban apply mode"
  echo ""

  # Verify source exists
  if [[ ! -f "$JAIL_SOURCE" ]]; then
    log_die "jail config not found: $JAIL_SOURCE" 1
  fi

  # Check if fail2ban is installed
  if ! command -v fail2ban-client >/dev/null 2>&1; then
    log_warn "fail2ban-client not found — cannot deploy"
    log_warn "Install fail2ban first: apt install fail2ban"
    return 1
  fi

  # Check if we can sudo
  if ! sudo -n true 2>/dev/null; then
    log_warn "sudo not available without password — cannot deploy to /etc/fail2ban/"
    log_warn "Run with: sudo $0 --apply"
    return 1
  fi

  # Create target directory if needed
  sudo mkdir -p /etc/fail2ban/jail.d

  # Deploy jail config
  sudo cp -f "$JAIL_SOURCE" "$JAIL_DEST"
  sudo chmod 644 "$JAIL_DEST"
  log_info "deployed $JAIL_SOURCE -> $JAIL_DEST"

  # Reload fail2ban
  if sudo fail2ban-client reload 2>/dev/null; then
    log_info "fail2ban reloaded"
  else
    log_warn "fail2ban-client reload failed — restart manually: systemctl restart fail2ban"
  fi

  # Verify jails are active
  if sudo fail2ban-client status 2>/dev/null; then
    log_info "fail2ban status:"
    sudo fail2ban-client status 2>/dev/null || true
  fi

  log_info "fail2ban jail config applied"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)  MODE="check"; shift ;;
    --apply)  MODE="apply"; shift ;;
    --help|-h) usage; exit 0 ;;
    *)        log_die "unknown option: $1 — see --help" 1 ;;
  esac
done

case "$MODE" in
  check) cmd_check ;;
  apply) cmd_apply ;;
  "")    usage; exit 1 ;;
  *)     log_die "unknown mode: $MODE" 1 ;;
esac
