#!/bin/bash
# Exposure TUI — choose per-UI wiring and apply it:
#
#   local      bind 127.0.0.1        (host only)
#   public     bind 0.0.0.0          (all interfaces — LAN/school/internet)
#   ts-http    bind <tailscale IP>   (WireGuard-encrypted plain HTTP via tailnet)
#   ts-https   bind 127.0.0.1 + `tailscale serve` listener
#              (needs NO tailscale IP: URL is https://<node>.<tailnet>.ts.net:<port>)
#
# Selections are written to the *_BIND_IP variables in .env.admin/.env.contest
# and tailscale serve entries are registered/removed to match.
#
# Usage: ./cms expose   (interactive tty)

set -euo pipefail
cd "$(dirname "$0")/.."

CONTEST_ENV=".env.contest"
ADMIN_ENV=".env.admin"

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
die() { log_warn "ERROR: $*"; exit 1; }

C_DIM=$'\033[2m'; C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'

env_val() {
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}
env_set() {
  local f="$1" k="$2" v="$3"
  if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"
  else echo "$k=$v" >> "$f"; fi
}

ts_ip() { command -v tailscale >/dev/null 2>&1 && tailscale ip -4 2>/dev/null | head -1 || true; }

ts_serve() {  # args passthrough with sudo fallback
  if tailscale debug prefs >/dev/null 2>&1; then tailscale serve "$@"
  else sudo tailscale serve "$@"; fi
}

# name|envfile|bindkey|backend_port|serve_env_key|default_https_port
ROWS=(
  "contest-web|$CONTEST_ENV|CONTEST_BIND_IP|8888|TS_HTTPS_CONTEST|8846"
  "nginx-front|$CONTEST_ENV|NGINX_BIND_IP|80||"
  "classic-admin|$ADMIN_ENV|ADMIN_BIND_IP|8889|TS_HTTPS_CLASSIC|8844"
  "ranking|$ADMIN_ENV|RANKING_BIND_IP|8890|TS_HTTPS_RANKING|8845"
  "admin-panel|$ADMIN_ENV|ADMIN_NEXT_BIND_IP|8891|TS_HTTPS_PANEL|8843"
)
MODES=(local public ts-http ts-https)   # nginx-front supports all but ts-https
NROWS=${#ROWS[@]}
CUR=0
declare -a SEL=()

row_name()  { local r="$1"; IFS='|' read -r n _ <<<"$r"; echo "$n"; }
row_field() { local r="$1" n="$2"; IFS='|' read -r a b c d e f <<<"$r"; case "$n" in env) echo "$b";; bind) echo "$c";; bport) echo "$d";; skey) echo "$e";; hdef) echo "$f";; esac; }

supports_ts_https() { [ -n "$(row_field "${ROWS[$1]}" skey)" ]; }

detect_mode() { # idx -> active mode string
  local idx="$1" f k sip b servekey hp
  f="$(row_field "${ROWS[$idx]}" env)"; k="$(row_field "${ROWS[$idx]}" bind)"
  servekey="$(row_field "${ROWS[$idx]}" skey)"
  sip="$(ts_ip)"
  if [ -n "$servekey" ]; then
    hp="$(env_val "$ADMIN_ENV" "$servekey")"; hp="${hp:-$(row_field "${ROWS[$idx]}" hdef)}"
    if tailscale serve status 2>/dev/null | grep -qE ":$hp\b"; then echo "ts-https"; return; fi
  fi
  b="$(env_val "$f" "$k")"; b="${b:-0.0.0.0}"
  case "$b" in
    127.0.0.1) echo "local" ;;
    ""|0.0.0.0|\*) echo "public" ;;
    *) if [ -n "$sip" ] && [ "$b" = "$sip" ]; then echo "ts-http"; else echo "public"; fi ;;
  esac
}

init_selections() {
  local i m
  SEL=()
  for i in $(seq 0 $((NROWS-1))); do
    m="$(detect_mode "$i")"
    case "$m" in local) SEL+=(0);; public) SEL+=(1);; ts-http) SEL+=(2);; ts-https) SEL+=(3);; *) SEL+=(1);; esac
  done
}

cycle_next() { # skip unsupported modes for a row
  local idx="$1" tries=0 next
  next=$(( (SEL[idx] + 1) % 4 ))
  while [ "$tries" -lt 4 ]; do
    if [ "${MODES[$next]}" = ts-https ] && ! supports_ts_https "$idx"; then
      next=$(( (next + 1) % 4 )); tries=$((tries+1)); continue
    fi
    SEL[$idx]=$next; return
  done
}
cycle_prev() {
  local idx="$1" tries=0 next
  next=$(( (SEL[idx] + 3) % 4 ))
  while [ "$tries" -lt 4 ]; do
    if [ "${MODES[$next]}" = ts-https ] && ! supports_ts_https "$idx"; then
      next=$(( (next + 3) % 4 )); tries=$((tries+1)); continue
    fi
    SEL[$idx]=$next; return
  done
}

mode_label() {
  case "$1" in
    local)    printf '%slocal%s     127.0.0.1' "$C_DIM" "$C_0" ;;
    public)   printf '%spublic%s    0.0.0.0 ' "$C_R" "$C_0" ;;
    ts-http)  printf '%sts-http%s   <ts-ip> ' "$C_Y" "$C_0" ;;
    ts-https) printf '%sts-https%s  loopback+serve' "$C_G" "$C_0" ;;
  esac
}

render() {
  local i row name mode port mark urlhint hp
  printf '%sUI Exposure Matrix%s — ←→ pick wiring, ⏎ apply row, A apply all\n' "$C_B" "$C_0"
  printf ' %-3s %-14s %-28s %-7s %s\n' "sel" "service" "wiring (sel → active)" "port" "url hint"
  for i in $(seq 0 $((NROWS-1))); do
    row="${ROWS[$i]}"; name="$(row_name "$row")"
    case "$name" in contest-web) port=8888;; nginx-front) port='80/443';; classic-admin) port=8889;; ranking) port=8890;; admin-panel) port=8891;; esac
    mode="$(detect_mode "$i")"
    mark=" "; [ "$i" = "$CUR" ] && mark=">" && printf '%s' "$C_B"
    urlhint=""
    if [ "${SEL[$i]}" = 3 ] || [ "$mode" = ts-https ]; then
      hp="$(env_val "$ADMIN_ENV" "$(row_field "$row" skey)")"; hp="${hp:-$(row_field "$row" hdef)}"
      urlhint="https://<node>.ts.net:$hp"
    elif [ "${MODES[SEL[$i]]}" = public ]; then urlhint="http://<host>: $port"
    elif [ "${MODES[SEL[$i]]}" = ts-http ]; then urlhint="http://<ts-ip>:$port"; else urlhint="localhost only"; fi
    printf ' %-3s %-14s %-11b → %-15b %-7s %s%s\n' \
      "$mark" "$name" \
      "$(mode_label "${MODES[SEL[$i]]}")" "$(mode_label "$mode")" \
      "$port" "$urlhint" "$C_0"
  done
  echo ""
  echo " ←→ cycle · ⏎ apply cursor row · A apply changed rows · r refresh · q quit"
}

apply_row() {
  local idx="$1"
  local mode="${MODES[SEL[$idx]]}" f k bport servekey hp prev sip
  f="$(row_field "${ROWS[$idx]}" env)"; k="$(row_field "${ROWS[$idx]}" bind)"
  bport="$(row_field "${ROWS[$idx]}" bport)"; servekey="$(row_field "${ROWS[$idx]}" skey)"
  prev="$(detect_mode "$idx")"
  sip="$(ts_ip)"

  case "$mode" in
    local)  env_set "$f" "$k" "127.0.0.1" ;;
    public) env_set "$f" "$k" "0.0.0.0" ;;
    ts-http)
      [ -n "$sip" ] || die "tailscale IP unavailable — run 'tailscale up' first"
      env_set "$f" "$k" "$sip" ;;
    ts-https)
      require_ts_check
      env_set "$f" "$k" "127.0.0.1"
      hp="$(env_val "$ADMIN_ENV" "$servekey")"; hp="${hp:-$(row_field "${ROWS[$idx]}" hdef)}"
      log_info "tailscale serve --https=$hp -> 127.0.0.1:$bport"
      if [ "${TS_DRY_RUN:-0}" != 1 ]; then ts_serve --bg --https="$hp" "http://127.0.0.1:$bport"
      else printf '  would run: tailscale serve --bg --https=%s http://127.0.0.1:%s\n' "$hp" "$bport"; fi ;;
  esac

  if [ "$mode" != ts-https ] && [ "$prev" = ts-https ] && [ -n "$servekey" ]; then
    hp="$(env_val "$ADMIN_ENV" "$servekey")"; hp="${hp:-$(row_field "${ROWS[$idx]}" hdef)}"
    log_info "removing serve on :$hp"
    if [ "${TS_DRY_RUN:-0}" != 1 ]; then ts_serve --https="$hp" off || true; fi
  fi

  log_info "$(row_name "${ROWS[$idx]}"): $prev → $mode  ($k=$(env_val "$f" "$k"))"
}

require_ts_check() {
  command -v tailscale >/dev/null 2>&1 || die "tailscale CLI not found on host"
}

recreate_prompt() {
  local da=0 dc=0 i name yn
  for i in ${CHANGED[@]+"${CHANGED[@]}"}; do
    name="$(row_name "${ROWS[$i]}")"
    case "$name" in classic-admin|ranking|admin-panel) da=1 ;; contest-web|nginx-front) dc=1 ;; esac
  done
  local stacks=""
  [ "$da" = 1 ] && stacks+=" admin"
  [ "$dc" = 1 ] && stacks+=" contest"
  [ -z "$stacks" ] && return 0
  printf 'Recreate stack(s)%s now? [y/N] ' "$stacks"
  IFS= read -r yn || true
  if [[ "$yn" =~ ^[Yy] ]]; then
    [ "$da" = 1 ] && { DEPLOYMENT_TYPE_OVERRIDE=img make -s admin || make -s admin; }
    [ "$dc" = 1 ] && { DEPLOYMENT_TYPE_OVERRIDE=img make -s contest || make -s contest; }
  else
    log_info "Apply later with: ./cms deploy${stacks} --img"
  fi
  CHANGED=()
}

tui_loop() {
  init_selections
  CHANGED=()
  while true; do
    clear 2>/dev/null || true
    render
    local key esc
    if ! IFS= read -rsn1 key; then key=q; fi
    if [ "$key" = $'\x1b' ]; then
      esc=""
      IFS= read -rsn2 -t 0.05 esc || true
      case "$esc" in
        '[D'|'[A') cycle_prev "$CUR" ;;
        '[C'|'[B') cycle_next "$CUR" ;;
      esac
      continue
    fi
    case "$key" in
      h) cycle_prev "$CUR" ;;
      l) cycle_next "$CUR" ;;
      $'\n'|$'\r')
        set +e; apply_row "$CUR"; set -e
        local dup=0 x
        for x in ${CHANGED[@]+"${CHANGED[@]}"}; do [ "$x" = "$CUR" ] && dup=1 && break; done
        [ "$dup" = 0 ] && CHANGED+=("$CUR")
        recreate_prompt ;;
      A)
        local i
        for i in $(seq 0 $((NROWS-1))); do
          set +e; apply_row "$i"; set -e
          CHANGED+=("$i")
        done
        recreate_prompt ;;
      r) init_selections ;;
      q|Q) clear 2>/dev/null || true; exit 0 ;;
    esac
  done
}

case "${1:-tui}" in
  tui)
    [ -t 0 ] && [ -t 1 ] || die "needs a terminal"
    [ -f "$ADMIN_ENV" ] || die "$ADMIN_ENV missing — run ./cms first"
    [ -f "$CONTEST_ENV" ] || die "$CONTEST_ENV missing — run ./cms first"
    tui_loop ;;
  *) die "usage: $0 [tui]" ;;
esac
