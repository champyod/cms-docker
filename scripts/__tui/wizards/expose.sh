#!/usr/bin/env bash
# Exposure wizard — per-UI wiring chooser (gum rebuild of __exposure_tui.sh).
#
# Wiring modes:
#   local     bind 127.0.0.1        (host only)
#   public    bind 0.0.0.0          (all interfaces — LAN/school/internet)
#   ts-http   bind <tailscale IP>   (WireGuard-encrypted plain HTTP via tailnet)
#   ts-https  bind 127.0.0.1 + `tailscale serve` listener
#             (needs NO tailscale IP: URL is https://<node>.<tailnet>.ts.net:<port>)
#
# Selections are written to the *_BIND_IP variables in .env.admin/.env.contest
# and tailscale serve entries are registered/removed to match.
#
# Usage: ./cms expose

TUI_STANDALONE=0
[[ "${BASH_SOURCE[0]}" == "$0" ]] && { TUI_STANDALONE=1; set -euo pipefail; }

CONTEST_ENV=".env.contest"
ADMIN_ENV=".env.admin"

log_info() { printf '[INFO] %s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

# name|envfile|bindkey|backend_port|serve_env_key|default_https_port
ROWS=(
  "contest-web|$CONTEST_ENV|CONTEST_BIND_IP|8888|TS_HTTPS_CONTEST|8846"
  "nginx-front|$CONTEST_ENV|NGINX_BIND_IP|80||"
  "classic-admin|$ADMIN_ENV|ADMIN_BIND_IP|8889|TS_HTTPS_CLASSIC|8844"
  "ranking|$ADMIN_ENV|RANKING_BIND_IP|8890|TS_HTTPS_RANKING|8845"
  "admin-panel|$ADMIN_ENV|ADMIN_NEXT_BIND_IP|8891|TS_HTTPS_PANEL|8843"
)
MODES=(local public ts-http ts-https domain)   # nginx-front supports all but ts-https and domain

row_field() {
  local a b c d e f
  IFS='|' read -r a b c d e f <<<"$1"
  case "$2" in
    name) echo "$a" ;; env) echo "$b" ;; bind) echo "$c" ;;
    bport) echo "$d" ;; skey) echo "$e" ;; hdef) echo "$f" ;;
  esac
}

env_val() {
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

env_set() {
  local f="$1" k="$2" v="$3"
  if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=$v|" "$f"
  else echo "$k=$v" >>"$f"; fi
}

ts_ip() { command -v tailscale >/dev/null 2>&1 && tailscale ip -4 2>/dev/null | head -1 || true; }

ts_serve() {  # args passthrough with sudo fallback
  if tailscale debug prefs >/dev/null 2>&1; then tailscale serve "$@"
  else sudo tailscale serve "$@"; fi
}

supports_ts_https() { [ -n "$(row_field "${ROWS[$1]}" skey)" ]; }

serve_hp() {  # idx -> https port (configured or default)
  local hp
  hp="$(env_val "$ADMIN_ENV" "$(row_field "${ROWS[$1]}" skey)")"
  echo "${hp:-$(row_field "${ROWS[$1]}" hdef)}"
}

detect_mode() {  # idx -> active mode string
  local idx="$1" f k sip servekey b
  f="$(row_field "${ROWS[$idx]}" env)"; k="$(row_field "${ROWS[$idx]}" bind)"
  servekey="$(row_field "${ROWS[$idx]}" skey)"
  sip="$(ts_ip)"
  if [ -n "$servekey" ] && tailscale serve status 2>/dev/null | grep -qE ":$(serve_hp "$idx")\b"; then
    echo "ts-https"; return
  fi
  b="$(env_val "$f" "$k")"; b="${b:-0.0.0.0}"
  case "$b" in
    127.0.0.1) echo "local" ;;
    ""|0.0.0.0|\*) echo "public" ;;
    *) if [ -n "$sip" ] && [ "$b" = "$sip" ]; then echo "ts-http"; else echo "public"; fi ;;
  esac
}

require_ts_check() {
  command -v tailscale >/dev/null 2>&1 || die "tailscale CLI not found on host"
}

apply_row() {  # idx mode — identical effects to the legacy exposure TUI
  local idx="$1" mode="$2"
  local f k bport servekey prev sip
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
      log_info "tailscale serve --bg --https=$(serve_hp "$idx") http://127.0.0.1:$bport"
      if [ "${TS_DRY_RUN:-0}" != 1 ]; then
        ts_serve --bg "--https=$(serve_hp "$idx")" "http://127.0.0.1:$bport"
      else
        printf '  would run: tailscale serve --bg --https=%s http://127.0.0.1:%s\n' \
          "$(serve_hp "$idx")" "$bport"
      fi ;;
    domain)
      env_set "$f" "$k" "127.0.0.1"
      log_info "domain mode: service binds localhost, nginx reverse-proxies via $(env_val .env.core CMS_DOMAIN 2>/dev/null || echo grader.mwit.ac.th)"
      ;;
  esac

  if [ "$mode" != ts-https ] && [ "$prev" = ts-https ] && [ -n "$servekey" ] && [ "${TS_DRY_RUN:-0}" != 1 ]; then
    log_info "removing serve on :$(serve_hp "$idx")"
    ts_serve --https="$(serve_hp "$idx")" off || true
  fi

  tui::audit "expose.apply" "$(row_field "${ROWS[$idx]}" name): $prev → $mode ($k=$(env_val "$f" "$k"))"
  log_info "$(row_field "${ROWS[$idx]}" name): $prev → $mode  ($k=$(env_val "$f" "$k"))"
}

url_hint() {  # idx mode -> human URL preview
  local port
  case "$(row_field "${ROWS[$1]}" name)" in
    contest-web) port=8888 ;; nginx-front) port='80/443' ;;
    classic-admin) port=8889 ;; ranking) port=8890 ;; admin-panel) port=8891 ;;
  esac
  case "$2" in
    ts-https) echo "https://<node>.ts.net:$(serve_hp "$1")" ;;
    domain)   echo "https://$(env_val .env.core CMS_DOMAIN 2>/dev/null || echo grader.mwit.ac.th)/" ;;
    public)   echo "http://<host>:$port" ;;
    ts-http)  echo "http://<ts-ip>:$port" ;;
    *)        echo "localhost only" ;;
  esac
}

show_matrix() {  # PENDING[idx] vs live state, as a gum table (plain cat fallback)
  local i
  printf 'service\twiring (active → planned)\turl hint\n'
  for i in "${!ROWS[@]}"; do
    printf '%s\t%s → %s\t%s\n' \
      "$(row_field "${ROWS[$i]}" name)" \
      "$(detect_mode "$i")" "${PENDING[$i]}" \
      "$(url_hint "$i" "${PENDING[$i]}")"
  done | tui::table
}

recreate_prompt() {  # offer stack recreation for changed rows (admin/contest split)
  local da=0 dc=0 i name stacks=""
  for i in ${CHANGED[@]+"${CHANGED[@]}"}; do
    name="$(row_field "${ROWS[$i]}" name)"
    case "$name" in classic-admin|ranking|admin-panel) da=1 ;; contest-web|nginx-front) dc=1 ;; esac
  done
  [ "$da" = 1 ] && stacks+=" admin"
  [ "$dc" = 1 ] && stacks+=" contest"
  [ -z "$stacks" ] && return 0
  CHANGED=()
  tui::confirm "Recreate stack(s)$stacks now?" || {
    log_info "Apply later with: ./cms deploy$stacks --img"
    return 0
  }
  tui::audit "expose.recreate" "$stacks"
  [ "$da" = 1 ] && { DEPLOYMENT_TYPE_OVERRIDE=img make -s admin || make -s admin; }
  [ "$dc" = 1 ] && { DEPLOYMENT_TYPE_OVERRIDE=img make -s contest || make -s contest; }
}

pick_mode() {  # idx -> chosen mode (respects per-row support matrix)
  local idx="$1" opts=() m
  for m in "${MODES[@]}"; do
    if [ "$m" = ts-https ] && ! supports_ts_https "$idx"; then continue; fi
    if [ "$m" = domain ] && [ "$(row_field "${ROWS[$idx]}" name)" = nginx-front ]; then continue; fi
    opts+=("$m")
  done
  tui::choose "Wiring for $(row_field "${ROWS[$idx]}" name):" "${opts[@]}"
}

apply_pending_all() {  # re-assert every row's planned wiring, then recreate stacks
  local i
  CHANGED=()
  for i in "${!ROWS[@]}"; do
    apply_row "$i" "${PENDING[$i]}" || true
    CHANGED+=("$i")
  done
  recreate_prompt
}

wizard_loop() {
  local i sel names=()
  for i in "${!ROWS[@]}"; do names+=("$(row_field "${ROWS[$i]}" name)"); done
  while :; do
    show_matrix
    sel="$(tui::choose "UI exposure — pick a service:" \
      "${names[@]}" "Apply ALL planned wiring" "Quit")" || exit 0
    case "$sel" in
      "Apply ALL planned wiring") apply_pending_all ;;
      Quit) exit 0 ;;
      *)
        for i in "${!ROWS[@]}"; do [ "${names[$i]}" = "$sel" ] && break; done
        mode="$(pick_mode "$i")" || continue
        PENDING[$i]="$mode"
        apply_row "$i" "$mode" || true
        CHANGED+=("$i")
        recreate_prompt ;;
    esac
  done
}

init_pending() {
  local i
  PENDING=()
  for i in "${!ROWS[@]}"; do PENDING+=("$(detect_mode "$i")"); done
  CHANGED=()
}

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
  tui::init || die "expose needs an interactive terminal (>=80x24)"
  [ -f "$ADMIN_ENV" ] || die "$ADMIN_ENV missing — run ./cms first"
  [ -f "$CONTEST_ENV" ] || die "$CONTEST_ENV missing — run ./cms first"
  init_pending
  tui::header "CMS UI Exposure"
  wizard_loop
}

if [[ "$TUI_STANDALONE" == 1 ]]; then main "$@"; fi
