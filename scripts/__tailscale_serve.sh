#!/bin/bash
# Tailscale HTTPS front for admin panel / classic admin / ranking.
#
# Registers `tailscale serve` listeners that proxy tailnet HTTPS ports to the
# loopback-bound CMS UIs, and optionally hides the raw plaintext ports by
# rebinding them to 127.0.0.1 (.env.admin) so they are unreachable off-host.
#
# Env knobs (.env [admin] / [tailscale]):
#   TAILSCALE_SERVE=1              master switch consumed by ./cms bootstrap
#   TS_HTTPS_PANEL=8843            public https port  -> admin panel :8891
#   TS_HTTPS_CLASSIC=8844          -> classic admin :8889
#   TS_HTTPS_RANKING=8845          -> ranking :8890
#
# Usage:
#   __tailscale_serve.sh setup [--hide-ports] [--redeploy]
#   __tailscale_serve.sh remove
#   __tailscale_serve.sh status

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi
cd "$(dirname "$0")/.."

ADMIN_ENV=".env"
DRY_RUN="${TS_DRY_RUN:-0}"

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
die() { log_warn "ERROR: $*"; exit 1; }

env_val() {
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

require_ts() {
  command -v tailscale >/dev/null 2>&1 || die "tailscale CLI not found on host — install it and run 'tailscale up' first"
  tailscale status >/dev/null 2>&1 || die "tailscale daemon not connected — run 'sudo tailscale up' first"
}

ts_run() {  # try unprivileged first, fall back to sudo
  if tailscale version >/dev/null 2>&1 && tailscale debug prefs >/dev/null 2>&1; then
    tailscale "$@"
  else
    sudo tailscale "$@"
  fi
}

port_of() { env_val "$ADMIN_ENV" "$1"; }
https_port() {
  local v
  case "$1" in
    panel)  v="$(env_val "$ADMIN_ENV" TS_HTTPS_PANEL)" ;;
    classic) v="$(env_val "$ADMIN_ENV" TS_HTTPS_CLASSIC)" ;;
    ranking) v="$(env_val "$ADMIN_ENV" TS_HTTPS_RANKING)" ;;
  esac
  echo "${v:-$2}"
}

serve_map() {  # emits "https_port backend_port label"
  echo "$(https_port panel 8843)|$(port_of ADMIN_NEXT_PORT_EXTERNAL)|admin-panel"
  echo "$(https_port classic 8844)|$(port_of ADMIN_PORT_EXTERNAL)|classic-admin"
  echo "$(https_port ranking 8845)|$(port_of RANKING_PORT_EXTERNAL)|ranking"
}

cmd_setup() {
  require_ts
  local hide=0 redeploy=0
  [ "${2:-}" = "--hide-ports" ] && hide=1
  [ "${3:-}" = "--redeploy" ] && redeploy=1

  local row hp bp label fqdn
  fqdn="$(tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' | tr -d '.' || true)"
  while IFS='|' read -r hp bp label; do
    [ -z "$bp" ] && bp="8891"
    log_info "tailscale serve --https=$hp -> 127.0.0.1:$bp  ($label)"
    if [ "$DRY_RUN" = 1 ]; then
      printf '  would run: tailscale serve --bg --https=%s http://127.0.0.1:%s\n' "$hp" "$bp"
    else
      ts_run serve --bg --https="$hp" "http://127.0.0.1:$bp" \
        || die "failed to register serve for $label (port $hp)"
    fi
  done < <(serve_map)

  if [ "$DRY_RUN" != 1 ]; then
    [ -n "$fqdn" ] && log_info "URL base: https://${fqdn#.}:<port> per mapping above"
    ts_run serve status || true
  fi

  if [ "$hide" = 1 ]; then
    local toml="config.toml"
    [ -f "$toml" ] || die "config.toml missing"
    if grep -qE '^ADMIN_NEXT_LISTEN_ADDRESS\s*=\s*"127\.0\.0\.1"' "$toml" \
       && grep -qE '^ADMIN_LISTEN_ADDRESS\s*=\s*"127\.0\.0\.1"' "$toml" \
       && grep -qE '^RANKING_LISTEN_ADDRESS\s*=\s*"127\.0\.0\.1"' "$toml"; then
      log_info "raw ports already bound to loopback"
    else
      python3 - "$toml" <<'PYEOF'
import re
from pathlib import Path
p = Path("config.toml")
t = p.read_text()
for key in ("ADMIN_NEXT_LISTEN_ADDRESS", "ADMIN_LISTEN_ADDRESS", "RANKING_LISTEN_ADDRESS"):
    pattern = rf'^{key}\s*=.*'
    replacement = f'{key} = "127.0.0.1"'
    if re.search(pattern, t, re.MULTILINE):
        t = re.sub(pattern, replacement, t, flags=re.MULTILINE)
    else:
        t += f'\n{replacement}\n'
p.write_text(t)
PYEOF
      bash scripts/__config_sync.sh --no-secrets 2>/dev/null || log_warn "config sync after bind update failed"
      log_info "bind addresses moved to 127.0.0.1 in config.toml"
    fi
    if [ "$redeploy" = 1 ]; then
      log_info "Recreating admin stack with loopback binds ..."
      DEPLOYMENT_TYPE_OVERRIDE=img make -s admin || make -s admin
    else
      log_info "Apply new binds with: ./cms deploy admin --img"
    fi
  fi
}

cmd_remove() {
  require_ts
  local row hp bp label
  while IFS='|' read -r hp bp label; do
    log_info "removing serve on :$hp ($label)"
    if [ "$DRY_RUN" = 1 ]; then
      printf '  would run: tailscale serve --https=%s off\n' "$hp"
    else
      ts_run serve --https="$hp" off || true
    fi
  done < <(serve_map)
}

cmd_status() {
  tailscale serve status 2>/dev/null || sudo tailscale serve status 2>/dev/null || die "unable to query tailscale serve status"
  echo ""
  echo "Planned mapping:"
  serve_map | while IFS='|' read -r hp bp label; do
    printf '  https://<node>.ts.net:%-6s -> 127.0.0.1:%-6s (%s)\n' "$hp" "$bp" "$label"
  done
}

case "${1:-setup}" in
  setup)
    cmd_setup "${2:-}" "${3:-}" ;;
  remove) cmd_remove ;;
  status) cmd_status ;;
  *) die "usage: $0 [setup [--hide-ports] [--redeploy]|remove|status]" ;;
esac
