#!/usr/bin/env bash
# scripts/__admin_panel_swap.sh — move the admin panel to its other colour without a 502.
#
# The front dials exactly one colour. This script starts the other beside it, waits for its
# healthcheck, re-points the front, and proves one request through the front before it stops
# the colour that was serving. Every failure before the probe puts the front back on the
# colour it was serving and leaves that colour running; nothing is stopped on a guess.
#
# Usage: bash scripts/__admin_panel_swap.sh [--timeout SECONDS] [--probe-url URL]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
. "${SCRIPT_DIR}/__lib/common.sh"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/__admin_panel_target.sh"

# The healthcheck budget: the panel's own start_period is 30 s and its checks run every 10 s,
# so 180 s covers a cold Next.js boot with room to spare.
TIMEOUT=180
POLL_INTERVAL=2
# A single request through the front, not a load test: the swap only needs to know the new
# colour answers. The cap keeps a hung upstream from holding the retired colour hostage.
PROBE_TIMEOUT=10
PROBE_URL=""
PROBE_RESOLVE=""

usage() {
  cat <<'EOF'
Usage: bash scripts/__admin_panel_swap.sh [options]

Starts the idle admin-panel colour beside the active one, waits for its healthcheck,
re-points the nginx front at it, probes one request through that front, and only then stops
the colour that was serving. On any failure the front is put back and both colours are left
running.

  --timeout SECONDS   how long to wait for the stand-in to become healthy (default 180;
                      0 checks once and gives up, which is what the tests use)
  --probe-url URL     probe this URL instead of https://$ADMIN_DOMAIN:$DOMAIN_NGINX_HTTPS_PORT/
  -h, --help          this text
EOF
}

while (( $# )); do
  case "$1" in
    --timeout)   TIMEOUT="${2:?--timeout needs a value}"; shift 2 ;;
    --probe-url) PROBE_URL="${2:?--probe-url needs a value}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *)           log_die "unknown argument: $1 (try --help)" 1 ;;
  esac
done
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || log_die "--timeout must be a whole number of seconds" 1
[[ -f "${SCRIPT_DIR}/__domain_proxy_reload.sh" ]] \
  || log_die "missing ${SCRIPT_DIR}/__domain_proxy_reload.sh — the front cannot be re-rendered without it" 1
command -v docker >/dev/null 2>&1 || log_die "docker is not on PATH" 1

# The same file list the Makefile composes, so this starts the service the stack actually runs
# (an existing override or generated expose file would otherwise be dropped here).
COMPOSE_ARGS=(--project-directory "$REPO_ROOT")
for _f in docker-compose.yml docker-compose.override.yml docker-compose.expose.yml; do
  [[ -f "${REPO_ROOT}/${_f}" ]] && COMPOSE_ARGS+=(-f "${REPO_ROOT}/${_f}")
done
# core: the database the panel depends on must be in the model even with --no-deps.
COMPOSE_ARGS+=(--profile core --profile admin --profile admin-standby)

_compose() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

# One swap at a time: two operators (or a cron) racing would each start the other colour and
# then stop the one the winner had just routed to.
if command -v flock >/dev/null 2>&1; then
  exec 9>"${REPO_ROOT}/config/.admin-panel-swap.lock"
  flock -n 9 || log_die "another admin-panel swap is already running" 1
fi

# Reads one key from .env without sourcing it: the swap must not inherit (or export) the
# stack's secrets, and it only needs three routing values.
_env_val() {
  awk -F= -v k="$1" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' \
    "${REPO_ROOT}/.env" 2>/dev/null || true
}

_state_read() {
  local file="${REPO_ROOT}/${ADMIN_PANEL_STATE_FILE}" value
  [[ -r "$file" ]] || return 0
  value="$(tr -d '[:space:]' < "$file")"
  admin_panel_colour_valid "$value" \
    || log_die "${ADMIN_PANEL_STATE_FILE} holds '${value}', which is not a colour (a|b) — fix it or delete it" 1
  printf '%s' "$value"
}

_state_write() {
  local colour="$1" file tmp
  file="${REPO_ROOT}/${ADMIN_PANEL_STATE_FILE}"
  tmp="${file}.tmp.$$"
  printf '%s\n' "$colour" > "$tmp" && mv -f "$tmp" "$file"
  # WHY read back: the front is re-rendered from this file, so a write that silently failed
  # would leave the render pointing at the colour we are about to stop.
  [[ "$(_state_read)" == "$colour" ]] || log_die "could not record colour ${colour} in ${file}" 1
}

_container_health() {
  docker inspect --format '{{.State.Health.Status}}' "$1" 2>/dev/null || true
}

_is_running() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$(admin_panel_container "$1")"
}

# The colour the front is serving now. Reality wins over the record: a colour that is not
# running cannot be serving, however the file reads. When both run, the record decides —
# that is the state a failed swap leaves behind, and the record is what the front rendered.
_detect_active() {
  local a_running=0 b_running=0 recorded
  _is_running a && a_running=1
  _is_running b && b_running=1
  if (( a_running == 1 && b_running == 0 )); then printf 'a'; return 0; fi
  if (( b_running == 1 && a_running == 0 )); then printf 'b'; return 0; fi
  (( a_running == 1 && b_running == 1 )) || return 1
  recorded="$(_state_read)"
  printf '%s' "${recorded:-a}"
}

_start() {
  log_info "starting colour $1 ($(admin_panel_service "$1"))"
  _compose up -d --no-deps "$(admin_panel_service "$1")" >/dev/null
}

_wait_healthy() {
  local container deadline left
  container="$(admin_panel_container "$1")"
  deadline=$(( SECONDS + TIMEOUT ))
  while :; do
    [[ "$(_container_health "$container")" == "healthy" ]] && return 0
    (( SECONDS >= deadline )) && return 1
    left=$(( deadline - SECONDS ))
    (( left > POLL_INTERVAL )) && left="$POLL_INTERVAL"
    (( left > 0 )) && sleep "$left"
  done
}

_reload_front() {
  log_info "re-rendering the front for colour $(_state_read) and reloading it"
  bash "${SCRIPT_DIR}/__domain_proxy_reload.sh" --strict
}

# 2xx/3xx means the front reached a panel. 4xx means nginx answered without one, and 5xx is
# the 502 this whole exercise exists to remove — neither proves the new colour, so neither
# may retire the old one.
_probe() {
  local code
  if [[ -z "$PROBE_URL" ]]; then
    local domain port ip
    domain="$(_env_val ADMIN_DOMAIN)"
    [[ -n "$domain" ]] \
      || log_die "ADMIN_DOMAIN is not set in .env — pass --probe-url <url> to name the front by hand" 1
    port="$(_env_val DOMAIN_NGINX_HTTPS_PORT)"
    ip="$(_env_val DOMAIN_NGINX_BIND_IP)"
    PROBE_URL="https://${domain}:${port:-443}/"
    PROBE_RESOLVE="${domain}:${port:-443}:${ip:-127.0.0.1}"
  fi
  local -a args=(-k -sS -o /dev/null -w '%{http_code}' --max-time "$PROBE_TIMEOUT")
  [[ -n "$PROBE_RESOLVE" ]] && args+=(--resolve "$PROBE_RESOLVE")
  code="$(curl "${args[@]}" "$PROBE_URL" 2>/dev/null || true)"
  if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
    log_info "probe: HTTP ${code} from ${PROBE_URL}"
    return 0
  fi
  log_warn "probe: HTTP ${code:-no answer} from ${PROBE_URL} — the front did not reach a panel"
  return 1
}

_stop() {
  log_info "stopping colour $1 ($(admin_panel_service "$1"))"
  _compose stop "$(admin_panel_service "$1")" >/dev/null
}

# Puts the front back on the colour it was serving. The colour that failed stays up: it is
# the only copy of the new build, and nothing routes to it once the rollback reloads.
_rollback() {
  local previous="$1" target="$2"
  log_warn "swap to ${target} failed — restoring colour ${previous} on the front"
  _state_write "$previous"
  if _reload_front; then
    log_warn "rolled back: the front serves ${previous} again; colours ${previous} and ${target} are both running"
    exit 1
  fi
  log_die "ROLLBACK FAILED: the front may still name ${target} while ${previous} is the colour to serve. Re-run: bash scripts/__domain_proxy_reload.sh" 2
}

# Validate the record before anything moves: it is what the front renders from, so a
# corrupt one has to be fixed by hand rather than silently overwritten mid-swap.
_state_read >/dev/null

active="$(_detect_active)" \
  || log_die "no admin-panel colour is running — start one with 'make admin' before swapping" 1
target="$([[ "$active" == "a" ]] && printf 'b' || printf 'a')"
log_info "active colour: ${active}; stand-in: ${target}"

_start "$target"
if ! _wait_healthy "$target"; then
  log_die "colour ${target} was not healthy within ${TIMEOUT}s — the front still serves ${active}, which was left running" 1
fi

_state_write "$target"
_reload_front || _rollback "$active" "$target"
_probe || _rollback "$active" "$target"
_stop "$active"

log_info "swapped: the front serves ${target}; colour ${active} is stopped (image $(docker inspect --format '{{.Config.Image}}' "$(admin_panel_container "$target")" 2>/dev/null || printf 'unknown'))"
