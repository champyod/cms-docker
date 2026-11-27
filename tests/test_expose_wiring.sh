#!/usr/bin/env bash
# Pins config-only binds: the base stays single-address and the generated override carries comma lists.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MAKEFILE="${REPO_ROOT}/Makefile"
COMPOSE="${REPO_ROOT}/docker-compose.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

service_block() {
  local service="$1"
  awk -v service="$service" '
    $0 == "  " service ":" { inside = 1; next }
    inside && /^  [^ ]/ { exit }
    inside { print }
  ' "$COMPOSE"
}

check_loopback_publish() {
  local service="$1" mapping="$2" block ports publishes
  block="$(service_block "$service")"
  ports="$(awk '
    /^    ports:/ { inside = 1; next }
    inside && /^    [^ ]/ { exit }
    inside { print }
  ' <<<"$block")"
  if grep -qF -- "- \"${mapping}\"" <<<"$ports"; then
    ok "${service} publishes on 127.0.0.1"
  else
    no "${service} publishes on 127.0.0.1"
  fi
  publishes="$(grep -cE '^      - "' <<<"$ports" || true)"
  if [[ "${publishes:-0}" -eq 1 ]]; then
    ok "${service} publishes exactly one host entry"
  else
    no "${service} publishes exactly one host entry (found ${publishes:-0})"
  fi
}

# Front-door binds must stay out of the base port specs, or a comma list reaches docker compose.
for var in CONTEST_BIND_IP NGINX_BIND_IP ADMIN_BIND_IP ADMIN_NEXT_BIND_IP RANKING_BIND_IP; do
  if grep -qF -- "\${${var}:-" "$COMPOSE"; then
    no "base compose still interpolates ${var}"
  else
    ok "base compose no longer interpolates ${var}"
  fi
done

# These services speak HTTP and hold Secure cookies, so a direct routable publish is unusable.
check_loopback_publish contest-web-server \
  '127.0.0.1:${CONTEST_PORT_EXTERNAL:-8888}:${CONTEST_LISTEN_PORT:-8888}'
check_loopback_publish admin-web-server \
  '127.0.0.1:${ADMIN_PORT_EXTERNAL:-8889}:${ADMIN_LISTEN_PORT:-8889}'
check_loopback_publish ranking-web-server \
  '127.0.0.1:${RANKING_PORT_EXTERNAL:-8890}:${RANKING_LISTEN_PORT:-8890}'

# The panel identifies a caller from a proxy-asserted header, so direct access also spoofs its audit identity.
PANEL_BLOCK="$(awk '/^  admin-panel-next:/,/^  admin-web-server:/' "$COMPOSE")"
if printf '%s\n' "$PANEL_BLOCK" | grep -qF -- '- "127.0.0.1:${ADMIN_NEXT_PORT_EXTERNAL:-8891}:3000"'; then
  ok "admin-panel-next publishes on 127.0.0.1"
else
  no "admin-panel-next publishes on 127.0.0.1"
fi
publishes="$(printf '%s\n' "$PANEL_BLOCK" | grep -cE '^      - "[^"]*:[0-9]+"$' || true)"
if [[ "${publishes:-0}" -eq 1 ]]; then
  ok "admin-panel-next publishes exactly one host entry"
else
  no "admin-panel-next publishes exactly one host entry (found ${publishes:-0})"
fi

# Peer-facing binds are single-address by design and stay as they were.
for var in DB_BIND_IP WORKER_BIND_ADDR; do
  if grep -qF -- "\${${var}:-" "$COMPOSE"; then
    ok "peer-facing ${var} left in the base"
  else
    no "peer-facing ${var} left in the base"
  fi
done

# The Makefile regenerates the override and every stack target waits for it.
if grep -qE '^expose:$' "$MAKEFILE"; then
  ok "Makefile defines the expose target"
else
  no "Makefile defines the expose target"
fi
if grep -qF -- 'bash scripts/__render_expose.sh' "$MAKEFILE"; then
  ok "expose runs the generator"
else
  no "expose runs the generator"
fi
for target in core admin contest worker infra pull db-clean; do
  if grep -qE "^${target}: expose$" "$MAKEFILE"; then
    ok "${target} depends on expose"
  else
    no "${target} depends on expose"
  fi
done

# Both lists must be recursive so they re-evaluate after the generator runs.
for var in COMPOSE_FILES COMPOSE_FLAGS; do
  if grep -qE "^${var} = " "$MAKEFILE"; then
    ok "${var} is recursive"
  else
    no "${var} is recursive"
  fi
done

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
