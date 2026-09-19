#!/usr/bin/env bash
# scripts/__contest_dns_refresh.sh — refresh nginx after CWS recreate.
# Usage: __contest_dns_refresh.sh [--mode restart|reload|none]
# Single source of truth for the stale-upstream-DNS fix. Every deploy path
# (Makefile, Rust TUI, admin panel) delegates here instead of duplicating logic.
#
# WHY: nginx resolves `upstream cms_contest` once at startup. Recreating
# cms-contest-web-server changes its IP, leaving cms-nginx-contest with a
# stale address until it restarts or reloads.

set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=__lib/common.sh
source "${SCRIPT_DIR}/__lib/common.sh" 2>/dev/null || true
declare -F log_info >/dev/null || log_info() { echo "[INFO] $*"; }
declare -F log_warn >/dev/null || log_warn() { echo "[WARN] $*" >&2; }

MODE="${CONTEST_NGINX_REFRESH:-restart}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --mode=*) MODE="${1#--mode=}"; shift ;;
    -h|--help) echo "Usage: $0 [--mode restart|reload|none]"; exit 0 ;;
    *) echo "[FAIL] unknown argument: $1" >&2; exit 2 ;;
  esac
done

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then echo "docker compose"; else echo "docker-compose"; fi
}

compose_flags() {
  local flags=""
  [[ -f "$REPO_ROOT/docker-compose.yml" ]] && flags="$flags -f docker-compose.yml"
  [[ -f "$REPO_ROOT/docker-compose.override.yml" ]] && flags="$flags -f docker-compose.override.yml"
  printf '%s' "$flags"
}

refresh_restart() {
  local cmd flags
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^cms-nginx-contest$'; then
    log_warn "cms-nginx-contest not running — skipping restart"
    return 0
  fi
  cmd="$(compose_cmd)"
  flags="$(compose_flags)"
  # shellcheck disable=SC2086
  (cd "$REPO_ROOT" && $cmd $flags --profile core --profile contest restart nginx-proxy)
}

refresh_reload() {
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^cms-nginx-contest$'; then
    log_warn "cms-nginx-contest not running — skipping nginx reload"
    return 0
  fi
  docker exec cms-nginx-contest nginx -s reload
}

case "$MODE" in
  restart) log_info "refreshing cms-nginx-contest (restart) after CWS recreate"; refresh_restart ;;
  reload) log_info "refreshing cms-nginx-contest (reload) after CWS recreate"; refresh_reload ;;
  none) log_info "CONTEST_NGINX_REFRESH=none — skipping nginx refresh" ;;
  *) echo "[FAIL] invalid mode: $MODE (expected restart|reload|none)" >&2; exit 2 ;;
esac
