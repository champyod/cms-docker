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

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# lib/common.sh — the one source of log_info/log_warn/log_die. A missing library
# is a broken delivery and is reported as one, so a second copy of the helpers
# cannot drift from the one the rest of the scripts run.
# ---------------------------------------------------------------------------
if [[ ! -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  printf '[FAIL] %s\n' "missing ${SCRIPT_DIR}/__lib/common.sh — deliver scripts/__lib beside this script" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/__lib/common.sh"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
JAIL_SOURCE="${REPO_ROOT}/config/fail2ban/jail.d/grader.conf"
JAIL_DEST="/etc/fail2ban/jail.d/grader.conf"
# The nginx proxies write into named Docker volumes (cms-nginx-logs-domain,
# cms-nginx-logs-contest), so the host path is under the Docker root and there
# is no /var/log/nginx. The jail carries this placeholder; it is substituted at
# apply/check time with the volumes' host glob.
LOG_GLOB_PLACEHOLDER="__NGINX_LOG_GLOB__"
DOCKER_VOLUME_GLOB="volumes/cms-nginx-logs-*/_data/*error*.log"

docker_root() {
  docker info --format '{{.DockerRootDir}}' 2>/dev/null || printf '/var/lib/docker'
}

nginx_log_glob() {
  printf '%s/%s' "$(docker_root)" "$DOCKER_VOLUME_GLOB"
}

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

Log path: the nginx logs inside the named Docker volumes (cms-nginx-logs-domain,
          cms-nginx-logs-contest), resolved from the Docker root at run time.

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

  # Check the jail carries the placeholder the apply path substitutes
  printf '  %-40s' "Placeholder present:"
  if [[ -f "$JAIL_SOURCE" ]] && grep -q "$LOG_GLOB_PLACEHOLDER" "$JAIL_SOURCE"; then
    printf 'YES (%s)\n' "$LOG_GLOB_PLACEHOLDER"
  else
    printf 'NO (the jail must carry %s)\n' "$LOG_GLOB_PLACEHOLDER"
    ok=0
  fi

  # Check the resolved nginx log glob matches the volume logs
  local glob matches
  glob="$(nginx_log_glob)"
  printf '  %-40s' "nginx log glob:"
  printf '%s\n' "$glob"
  printf '  %-40s' "  matches:"
  # shellcheck disable=SC2086
  matches="$(compgen -G "$glob" || true)"
  if [[ -n "$matches" ]]; then
    printf 'logs present\n'
  else
    printf 'NO MATCH (nginx not started yet, or the Docker root moved)\n'
  fi

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

  # WHY the pre-check and not a prompt per step: --apply is also reached from the TUI,
  # where a password dialog would hang, and run_privileged prints the command to run.
  if ! can_escalate; then
    log_warn "not root and sudo is not available without a password — cannot deploy to /etc/fail2ban/"
    log_warn "Run with: sudo $0 --apply"
    return 1
  fi

  # Create target directory if needed
  run_privileged mkdir -p /etc/fail2ban/jail.d

  # Deploy the jail with the resolved volume log path
  local rendered
  rendered="$(mktemp)"
  sed "s#${LOG_GLOB_PLACEHOLDER}#$(nginx_log_glob)#g" "$JAIL_SOURCE" > "$rendered"
  run_privileged cp -f "$rendered" "$JAIL_DEST"
  rm -f "$rendered"
  run_privileged chmod 644 "$JAIL_DEST"
  log_info "deployed $JAIL_SOURCE -> $JAIL_DEST (log path $(nginx_log_glob))"

  # Reload fail2ban
  if run_privileged fail2ban-client reload 2>/dev/null; then
    log_info "fail2ban reloaded"
  else
    log_warn "fail2ban-client reload failed — restart manually: systemctl restart fail2ban"
  fi

  # Verify jails are active
  if run_privileged fail2ban-client status 2>/dev/null; then
    log_info "fail2ban status:"
    run_privileged fail2ban-client status 2>/dev/null || true
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
