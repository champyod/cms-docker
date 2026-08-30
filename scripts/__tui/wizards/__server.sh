#!/usr/bin/env bash
# Worker-server connection wizard (gum rebuild of __worker_server_tui.sh).
#
# Run on a WORKER machine to choose which main server this worker's containers
# talk to, then (re)deploy locally.
#
# Candidate list persists in .env.worker as:
#   WORKER_MAIN_<n>=<label>|<host>
# Applying an entry sets CORE_SERVICES_HOST=<host> so the worker's extra_hosts
# mapping (cms-log/resource/scoring/checker/evaluation/proxy) resolves there.
#
# Usage: ./cms worker server   (interactive tty)

TUI_STANDALONE=0
[[ "${BASH_SOURCE[0]}" == "$0" ]] && { TUI_STANDALONE=1; set -euo pipefail; }

WORKER_ENV=".env.worker"

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

env_val() {
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

ROWS=()   # "idx|label|host"

fleet_load() {
  ROWS=()
  local tmp line key rest idx label host
  tmp="$(mktemp)"
  awk -F= '/^WORKER_MAIN_[0-9]+=/ {print}' "$WORKER_ENV" 2>/dev/null | sort -t_ -k3,3n >"$tmp" || true
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    key="${line%%=*}"; rest="${line#*=}"
    idx="${key#WORKER_MAIN_}"
    label="${rest%%|*}"; host="${rest#*|}"
    if ! [[ "$idx" =~ ^[0-9]+$ ]]; then log_warn "skipping malformed: $line"; continue; fi
    if [ -z "$host" ]; then log_warn "skipping empty host: $line"; continue; fi
    ROWS+=("$idx|$label|$host")
  done <"$tmp"
  rm -f "$tmp"
}

next_idx() {
  local used=" " r i
  for r in ${ROWS[@]+"${ROWS[@]}"}; do i="${r%%|*}"; used+=" $i "; done
  local n=0
  while [[ "$used" == *" $n "* ]]; do n=$((n + 1)); done
  echo "$n"
}

save_entry() {  # idx label host — replace-or-append, byte format WORKER_MAIN_n=label|host
  local idx="$1" label="$2" host="$3" tmp
  tmp="$(mktemp)"
  grep -v "^WORKER_MAIN_$idx=" "$WORKER_ENV" >"$tmp" || true
  echo "WORKER_MAIN_$idx=$label|$host" >>"$tmp"
  mv "$tmp" "$WORKER_ENV"
}

delete_entry() {  # idx
  local tmp
  tmp="$(mktemp)"
  grep -v "^WORKER_MAIN_$1=" "$WORKER_ENV" >"$tmp" || true
  mv "$tmp" "$WORKER_ENV"
}

active_host() { env_val "$WORKER_ENV" CORE_SERVICES_HOST || true; }

set_core_services_host() {  # key=value replace-or-append in .env.worker
  local k="$1" v="$2"
  if grep -q "^$k=" "$WORKER_ENV"; then sed -i "s|^$k=.*|$k=$v|" "$WORKER_ENV"
  else echo "$k=$v" >>"$WORKER_ENV"; fi
}

do_connect() {  # row — set CORE_SERVICES_HOST, hint redeploy when it changed
  local row="$1" idx label host cur
  IFS='|' read -r idx label host <<<"$row"
  cur="$(active_host)"
  set_core_services_host CORE_SERVICES_HOST "$host"
  tui::audit "worker.server.connect" "$label -> $host"
  log_info "CORE_SERVICES_HOST := $host  ($label)"
  if [ "$cur" != "$host" ]; then
    log_info "Redeploy local workers to use it: ./cms worker deploy all"
  fi
}

ask_field() {  # question default -> value (empty allowed; caller validates)
  tui::gum input --header "$1" --placeholder "$2" --value "$2"
}

do_add() {
  local idx label host
  idx="$(next_idx)"
  label="$(ask_field "Label" "main-$idx")" || return 0
  host="$(ask_field "Host (main server)" "$(active_host)")" || return 0
  if [ -z "$host" ]; then log_warn "host required"; return 0; fi
  save_entry "$idx" "$label" "$host"
  tui::audit "worker.server.add" "$label -> $host"
  log_info "saved $label -> $host"
}

do_edit() {  # row
  local idx label host
  IFS='|' read -r idx label host <<<"$1"
  label="$(ask_field "Label" "$label")" || return 0
  host="$(ask_field "Host (main server)" "$host")" || return 0
  if [ -z "$host" ]; then log_warn "host required"; return 0; fi
  save_entry "$idx" "$label" "$host"
  tui::audit "worker.server.edit" "$label -> $host"
  log_info "updated $label -> $host (redeploy workers to apply)"
}

do_delete() {  # row
  local idx label host
  IFS='|' read -r idx label host <<<"$1"
  tui::confirm "Delete entry $label?" || return 0
  delete_entry "$idx"
  tui::audit "worker.server.delete" "$label"
  log_info "deleted $label"
}

show_table() {
  fleet_load
  local r idx label host st act
  act="$(active_host)"
  printf 'label\thost\tstate\n'
  for r in ${ROWS[@]+"${ROWS[@]}"}; do
    IFS='|' read -r idx label host <<<"$r"
    [ "$host" = "$act" ] && st="● active" || st="○ idle"
    printf '%s\t%s\t%s\n' "$label" "$host" "$st"
  done | tui::table
  tui::panel "Worker → Main-server Connections (.env.worker)" \
    "current CORE_SERVICES_HOST: ${act:-<unset>}"
}

pick_row() {  # prompt -> row ("idx|label|host"); fails on esc/no rows
  fleet_load
  [ "${#ROWS[@]}" -gt 0 ] || { log_warn "(no saved servers — add one first)"; return 1; }
  local r idx label host out=()
  for r in ${ROWS[@]+"${ROWS[@]}"}; do
    IFS='|' read -r idx label host <<<"$r"
    out+=("#$idx $label — $host")
  done
  local sel
  sel="$(tui::choose "$1" "${out[@]}")" || return 1
  for r in ${ROWS[@]+"${ROWS[@]}"}; do
    idx="${r%%|*}"
    [[ "$sel" == "#$idx "* ]] && { echo "$r"; return 0; }
  done
  return 1
}

wizard_loop() {
  while :; do
    show_table
    local action sel
    action="$(tui::choose "Action:" \
      "Connect (set CORE_SERVICES_HOST)" "Add server" "Edit server" \
      "Delete server" "Quit")" || exit 0
    case "$action" in
      Connect*)
        sel="$(pick_row "Connect to which main server?")" && do_connect "$sel" ;;
      "Add server") do_add ;;
      "Edit server")
        sel="$(pick_row "Edit which entry?")" && do_edit "$sel" ;;
      "Delete server")
        sel="$(pick_row "Delete which entry?")" && do_delete "$sel" ;;
      Quit) exit 0 ;;
    esac
  done
}

list_plain() {  # non-interactive listing (output shape preserved from legacy)
  fleet_load
  local r i l h act
  act="$(active_host)"
  for r in ${ROWS[@]+"${ROWS[@]}"}; do
    IFS='|' read -r i l h <<<"$r"
    printf '%-4s %-20s %-30s %s\n' "$i" "$l" "$h" "$([ "$h" = "$act" ] && echo active || echo idle)"
  done
}

require_env() { [ -f "$WORKER_ENV" ] || die "$WORKER_ENV missing — run ./cms first on this machine"; }

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1
  case "${1:-tui}" in
    tui)
      require_env
      tui::init || die "interactive TUI needs an interactive terminal (>=80x24)"
      tui::header "Worker Server Picker"
      wizard_loop ;;
    list) require_env; list_plain ;;
    *) die "usage: ${0##*/} [tui|list]" ;;
  esac
}

if [[ "$TUI_STANDALONE" == 1 ]]; then main "$@"; fi
