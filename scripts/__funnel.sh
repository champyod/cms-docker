#!/bin/bash
# Public (funnel) access manager — exposes password-gated UIs over the
# public internet via Tailscale Funnel, no tailnet membership needed.
#
#   https://<node>.<tailnet>.ts.net:8443  -> nginx basic-auth -> admin panel
#   https://<node>.<tailnet>.ts.net:10000 -> nginx basic-auth -> ranking
#
# Prereqs: FUNNEL_ENABLED=true in .env.admin, funnel enabled for the node
#          in the tailnet ACL policy ("nodeAttr": ["funnel"]), and creds set
#          via `./cms funnel passwd <user>`.
#
# Usage:
#   __funnel.sh setup     register funnels (+ ensure htpasswd + hint)
#   __funnel.sh remove    unregister
#   __funnel.sh status    show serve/funnel table
#   __funnel.sh passwd <user> [password]   write config/funnel.htpasswd

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi
cd "$(dirname "$0")/.."

HTPASSWD="config/funnel.htpasswd"
ADMIN_ENV=".env.admin"

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
die() { log_warn "ERROR: $*"; exit 1; }

env_val() { awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true; }

ts_run() {
  if tailscale debug prefs >/dev/null 2>&1; then tailscale "$@"
  else sudo tailscale "$@"; fi
}

require_ready() {
  command -v tailscale >/dev/null 2>&1 || die "tailscale CLI missing"
  [ "$(env_val "$ADMIN_ENV" FUNNEL_ENABLED || true)" = true ] || die "set FUNNEL_ENABLED=true in $ADMIN_ENV first"
}

funnel_ports() {
  echo "$(env_val "$ADMIN_ENV" FUNNEL_PUBLIC_ADMIN_PORT || echo 8443)|$(env_val "$ADMIN_ENV" FUNNEL_PANEL_LISTEN || echo 8892)|admin-panel"
  echo "$(env_val "$ADMIN_ENV" FUNNEL_PUBLIC_RANKING_PORT || echo 10000)|$(env_val "$ADMIN_ENV" FUNNEL_RANKING_LISTEN || echo 8893)|ranking"
}

ensure_htpasswd() {
  if [ ! -s "$HTPASSWD" ] || ! grep -qE '^[a-zA-Z0-9_.]+:' "$HTPASSWD"; then
    die "no valid credentials in $HTPASSWD — run: ./cms funnel passwd <user>"
  fi
}

cmd_passwd() {
  local user="${1:-}" pass="${2:-}"
  [ -n "$user" ] || die "usage: $0 passwd <user> [password]"
  case "$user" in *:*) die "htpasswd forbids ':' in username: $user" ;; esac
  mkdir -p "$(dirname "$HTPASSWD")"
  if [ -z "$pass" ]; then
    local attempts=0
    while :; do
      attempts=$((attempts + 1))
      printf 'Password for %s: ' "$user"
      read -rs pass; echo ""
      if [ "${#pass}" -ge 8 ]; then break; fi
      if [ "$attempts" -ge 3 ]; then die "password must be at least 8 characters"; fi
      log_warn "password must be at least 8 characters (attempt $attempts/3)"
    done
  else
    [ "${#pass}" -ge 8 ] || die "password must be at least 8 characters"
  fi
  local hash=""
  hash="$(openssl passwd -apr1 "$pass" 2>/dev/null || true)"
  if [ -z "$hash" ]; then
    log_warn "host openssl unavailable — using httpd:alpine container"
    hash="$(docker run --rm httpd:alpine htpasswd -nb "$user" "$pass" | cut -d: -f2-)"
  fi
  printf '%s:%s\n' "$user" "$hash" > "$HTPASSWD"
  chmod 600 "$HTPASSWD"
  log_info "credentials written to $HTPASSWD (user: $user)"
  log_info "recreate the proxy to pick them up: ./cms deploy contest --img"
}

cmd_setup() {
  require_ready
  ensure_htpasswd
  local row fp lp label fqdn
  fqdn="$(tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' | tr -d '.')"
  while IFS='|' read -r fp lp label; do
    log_info "funnel :$fp -> 127.0.0.1:$lp ($label, basic-auth protected)"
    ts_run funnel --bg --https="$fp" "http://127.0.0.1:$lp" \
      || die "funnel registration failed for $label — check that funnel is allowed in your tailnet ACL policy"
  done < <(funnel_ports)
  [ -n "$fqdn" ] && log_info "Public URLs:"
  [ -n "$fqdn" ] && funnel_ports | while IFS='|' read -r fp lp label; do
    printf '  https://%s:%-6s %s\n' "${fqdn#.}" "$fp" "$label"; done
  log_info "note: funnel serves only ports 443/8443/10000 — 443 is typically Portainer's"
}

cmd_remove() {
  local row fp lp label
  while IFS='|' read -r fp lp label; do
    log_info "removing funnel on :$fp ($label)"
    ts_run funnel --https="$fp" off 2>/dev/null || true
  done < <(funnel_ports)
}

cmd_status() {
  tailscale serve status 2>/dev/null || sudo tailscale serve status 2>/dev/null || true
  echo "--- planned funnel mapping ---"
  funnel_ports | while IFS='|' read -r fp lp label; do
    printf '  https://<node>.ts.net:%-6s -> 127.0.0.1:%-6s (%s)\n' "$fp" "$lp" "$label"; done
  if grep -qE '^[a-zA-Z0-9_.]+:' "$HTPASSWD" 2>/dev/null; then
    log_info "htpasswd present ($(cut -d: -f1 "$HTPASSWD" | head -1))"
  else
    log_warn "no credentials yet: ./cms funnel passwd <user>"
  fi
}

case "${1:-status}" in
  setup)  cmd_setup ;;
  remove) cmd_remove ;;
  status) cmd_status ;;
  passwd) shift; cmd_passwd "${@:-}" ;;
  *) die "usage: $0 [setup|remove|status|passwd <user> [pw]]" ;;
esac
