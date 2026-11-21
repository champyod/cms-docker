#!/usr/bin/env bash
# Pins the wiring that makes a comma-list <SVC>_BIND_IP publish config-only: the
# unified base compose file no longer interpolates the front-door binds (docker
# compose rejects a comma in a host_ip), and the Makefile regenerates the override
# from .env before a stack comes up so the configured addresses are what binds.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MAKEFILE="${REPO_ROOT}/Makefile"
COMPOSE="${REPO_ROOT}/docker-compose.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

# Front-door binds must be gone from the base port specs, or a comma list reaches
# docker compose and fails to parse.
for var in CONTEST_BIND_IP NGINX_BIND_IP ADMIN_BIND_IP ADMIN_NEXT_BIND_IP RANKING_BIND_IP; do
  if grep -qF -- "\${${var}:-" "$COMPOSE"; then
    no "base compose still interpolates ${var}"
  else
    ok "base compose no longer interpolates ${var}"
  fi
done

# The panel's host publish is the one front-door address the base file names itself,
# and it names it loopback. The panel identifies a caller from a proxy-asserted header
# (x-real-ip / rightmost x-forwarded-for), so a published address that reaches :8891
# without a proxy lets the caller choose its own login bucket and the identity its
# audit rows carry. Widening belongs to ADMIN_NEXT_BIND_IP in the generated override,
# one entry per address — a routable value is a decision to front the panel with a
# proxy of your own, never a convenience for reaching it directly.
PANEL_BLOCK="$(awk '/^  admin-panel-next:/,/^  admin-web-server:/' "$COMPOSE")"
if printf '%s\n' "$PANEL_BLOCK" | grep -qF -- '- "127.0.0.1:${ADMIN_NEXT_PORT_EXTERNAL:-8891}:3000"'; then
  ok "admin-panel-next publishes on 127.0.0.1"
else
  no "admin-panel-next publishes on 127.0.0.1"
fi
# One entry only: a second publish is how a routable address gets added alongside the
# loopback one, and the positive check above would stay green while it was.
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
