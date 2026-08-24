#!/bin/bash
edit_entry() {
  fleet_load
  local r="${ROWS[$CUR]}" idx label host
  IFS='|' read -r idx label host <<<"$r"
  if ui_form_edit "Edit $label" \
      "label|Label|$label" \
      "host|Host|$host"; then
    fleet_save_entry "$idx" "$FORM_OUT_label" "$FORM_OUT_host"
    log_info "updated $FORM_OUT_label -> $FORM_OUT_host (redeploy workers to apply)"
  fi
}

#!/bin/bash
# Worker-server connection TUI — run on a WORKER machine to choose which
# main server this worker's containers talk to, then (re)deploy locally.
#
# Candidate list persists in .env.worker as:
#   WORKER_MAIN_<n>=<label>|<host>
# Applying an entry sets CORE_SERVICES_HOST=<host> so the worker's
# extra_hosts mapping (cms-log/resource/scoring/checker/evaluation/proxy)
# all resolve to that main server.
#
# Usage: ./cms worker server   (interactive tty)

set -euo pipefail
cd "$(dirname "$0")/.."

WORKER_ENV=".env.worker"

# shellcheck disable=SC1091
[ -f scripts/__lib/form.sh ] && source scripts/__lib/form.sh
log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
die() { log_warn "ERROR: $*"; exit 1; }

C_DIM=$'\033[2m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'

env_val() { awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true; }

ROWS=()        # "idx|label|host"
CUR=0

fleet_load() {
  ROWS=()
  local tmp line key rest idx label host
  tmp="$(mktemp)"
  awk -F= '/^WORKER_MAIN_[0-9]+=/ {print}' "$WORKER_ENV" 2>/dev/null | sort -t_ -k3,3n > "$tmp" || true
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    key="${line%%=*}"; rest="${line#*=}"
    idx="${key#WORKER_MAIN_}"
    label="${rest%%|*}"; host="${rest#*|}"
    [[ "$idx" =~ ^[0-9]+$ ]] || { log_warn "skipping malformed: $line"; continue; }
    [ -z "$host" ] && { log_warn "skipping empty host: $line"; continue; }
    ROWS+=("$idx|$label|$host")
  done < "$tmp"
  rm -f "$tmp"
}

next_idx() {
  local used=" " r i
  for r in "${ROWS[@]}"; do i="${r%%|*}"; used+=" $i "; done
  local n=0
  while [[ "$used" == *" $n "* ]]; do n=$((n+1)); done
  echo "$n"
}

fleet_save_entry() { # idx label host  (replace or append line)
  local idx="$1" label="$2" host="$3" tmp
  tmp="$(mktemp)"
  grep -v "^WORKER_MAIN_$idx=" "$WORKER_ENV" > "$tmp" || true
  echo "WORKER_MAIN_$idx=$label|$host" >> "$tmp"
  mv "$tmp" "$WORKER_ENV"
}

fleet_delete() { # idx
  local tmp; tmp="$(mktemp)"
  grep -v "^WORKER_MAIN_$1=" "$WORKER_ENV" > "$tmp" || true
  mv "$tmp" "$WORKER_ENV"
}

active_host() { env_val "$WORKER_ENV" CORE_SERVICES_HOST || true; }

apply_target() { # row-index -> set CORE_SERVICES_HOST + hint redeploy
  local r="$1" idx label host cur
  IFS='|' read -r idx label host <<<"${ROWS[$r]}"
  cur="$(active_host)"
  env_set_kv CORE_SERVICES_HOST "$host"
  log_info "CORE_SERVICES_HOST := $host  ($label)"
  if [ "$cur" != "$host" ]; then
    log_info "Redeploy local workers to use it: ./cms worker deploy all"
  fi
}
env_set_kv() {
  local k="$1" v="$2"
  if grep -q "^$k=" "$WORKER_ENV"; then sed -i "s|^$k=.*|$k=$v|" "$WORKER_ENV"
  else echo "$k=$v" >> "$WORKER_ENV"; fi
}

render() {
  fleet_load
  local i row idx label host mark act
  act="$(active_host)"
  printf '%sWorker → Main-server Connections%s   (.env.worker)\n' "$C_B" "$C_0"
  printf ' %-4s %-22s %-28s %s\n' "sel" "label" "host" "state"
  for i in "${!ROWS[@]}"; do
    row="${ROWS[$i]}"; IFS='|' read -r idx label host <<<"$row"
    mark=" "
    [ "$i" = "$CUR" ] && mark=">" && printf '%s' "$C_B"
    if [ "$host" = "$act" ]; then st="${C_G}● active${C_0}"; else st="${C_DIM}○ idle${C_0}"; fi
    printf ' %-4s %-22s %-28s %b%s\n' "$mark" "$label" "$host" "$st" "$C_0"
  done
  [ "${#ROWS[@]}" = 0 ] && printf ' %s(no saved servers — press a to add)%s\n' "$C_DIM" "$C_0"
  echo ""
  echo " current CORE_SERVICES_HOST: ${act:-<unset>}"
  echo " ↑↓ move · ⏎ connect&set · a add · e edit · d delete · q quit"
}

add_entry() {
  local idx label host
  idx="$(next_idx)"
  if ui_form_edit "Add main server" \
      "label|Label|main-$idx" \
      "host|Host|$(active_host)"; then
    label="$FORM_OUT_label"; host="$FORM_OUT_host"
    [ -n "$host" ] || { log_warn "host required"; return 0; }
    fleet_save_entry "$idx" "$label" "$host"
    log_info "saved $label -> $host"
  fi
}

edit_entry() {
  fleet_load
  local r="${ROWS[$CUR]}" idx label host
  IFS='|' read -r idx label host <<<"$r"
  if ui_form_edit "Edit $label" \
      "label|Label|$label" \
      "host|Host|$host"; then
    [ -n "$FORM_OUT_host" ] || { log_warn "host required"; return 0; }
    fleet_save_entry "$idx" "$FORM_OUT_label" "$FORM_OUT_host"
    log_info "updated $FORM_OUT_label -> $FORM_OUT_host (redeploy workers to apply)"
  fi
}

tui_loop() {
  while true; do
    clear 2>/dev/null || true
    render
    local key esc r idx yn=""
    if ! IFS= read -rsn1 key; then key=q; fi
    if [ "$key" = $'\x1b' ]; then
      esc=""; IFS= read -rsn2 -t 0.05 esc || true
      case "$esc" in
        '[A'|'[D') [ "$CUR" -gt 0 ] && CUR=$((CUR-1)) || true ;;
        '[B'|'[C') fleet_load >/dev/null || true
                   { [ "${#ROWS[@]}" -gt 0 ] && [ "$CUR" -lt $((${#ROWS[@]}-1)) ]; } && CUR=$((CUR+1)) || true ;;
      esac
      continue
    fi
    case "$key" in
      j) fleet_load >/dev/null || true; { [ "${#ROWS[@]}" -gt 0 ] && [ "$CUR" -lt $((${#ROWS[@]}-1)) ]; } && CUR=$((CUR+1)) || true ;;
      k) [ "$CUR" -gt 0 ] && CUR=$((CUR-1)) || true ;;
      a) add_entry || true ;;
      e) fleet_load >/dev/null; { [ "${#ROWS[@]}" -gt 0 ] && edit_entry "$CUR"; } || true ;;
      d)
        fleet_load >/dev/null
        if [ "${#ROWS[@]}" -gt 0 ]; then
          r="${ROWS[$CUR]}"; idx="${r%%|*}"
          printf 'Delete entry %s? [y/N] ' "$(echo "$r" | cut -d'|' -f2)"
          IFS= read -r yn || true
          if [[ "$yn" =~ ^[Yy] ]]; then
            fleet_delete "$idx"
            [ "$CUR" -ge 1 ] && [ "$CUR" -ge "${#ROWS[@]}" ] && CUR=$((CUR-1))
            CUR=${CUR:-0}
          fi
        fi ;;
      $'\n'|$'\r')
        fleet_load >/dev/null
        { [ "${#ROWS[@]}" -gt 0 ] && apply_target "$CUR"; } || true
        printf '\nPress any key...'; IFS= read -rsn1 || true ;;
      q|Q) clear 2>/dev/null || true; exit 0 ;;
    esac
  done
}

require_env() { [ -f "$WORKER_ENV" ] || die "$WORKER_ENV missing — run ./cms first on this machine"; }

case "${1:-tui}" in
  tui)   require_env; tui_loop ;;
  list)
    require_env; fleet_load
    for r in "${ROWS[@]}"; do IFS='|' read -r i l h <<<"$r"; printf '%-4s %-20s %-30s %s\n' "$i" "$l" "$h" "$([ "$h" = "$(active_host)" ] && echo active || echo idle)"; done ;;
  *) die "usage: $0 [tui|list]" ;;
esac
