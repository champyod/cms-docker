#!/bin/bash
# Worker fleet TUI — manage the WORKER_<shard>=<host>:<port> registry in
# .env.core and deploy each local entry as its own compose project
# (cms-worker-<shard>, host port <port>).
#
# Data model (backward compatible):
#   .env.core   : WORKER_<shard>=host:port      <- registry, rendered into
#                                                  config/cms.toml by make env
#   .env.worker : all existing vars untouched    <- per-host worker defaults
#                 WORKER_SHARD<n>_LOCAL=0        <- OPTIONAL: registry-only,
#                                                 skip local deployment
#                 WORKER_SHARD<n>_MEMORY/_CPU    <- OPTIONAL per-shard overrides
#
# Usage:
#   scripts/__worker_tui.sh                              interactive TUI (tty)
#   scripts/__worker_tui.sh attach [spec host port-spec] attach a remote
#                                    worker box: registry-only rows for
#                                    spec "4", "4,5,6,7" or "4-7"
#   scripts/__worker_tui.sh deploy [all|<shard>|<spec>]  non-interactive deploy
#   scripts/__worker_tui.sh stop [all|<shard>|<spec>]
#   scripts/__worker_tui.sh list

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi
cd "$(dirname "$0")/.."

CORE_ENV=".env.core"
WORKER_ENV=".env.worker"

WORKERS=()      # rows: "shard|host|port|local(1/0)|memory|cpus"
CUR=0
SELECTED=()

# shellcheck disable=SC1091
[ -f scripts/__lib/common.sh ] && source scripts/__lib/common.sh
# shellcheck disable=SC1091
[ -f scripts/__lib/form.sh ] && source scripts/__lib/form.sh
log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
die() { log_warn "ERROR: $*"; exit 1; }

C_DIM=$'\033[2m'; C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'

env_val() { # file key -> value (exact key match, first hit)
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

global_memory() { env_val "$WORKER_ENV" WORKER_MEMORY_LIMIT || true; }
global_cpus()   { env_val "$WORKER_ENV" WORKER_CPU_LIMIT   || true; }
core_host_ip()  { env_val "$CORE_ENV"   CORE_SERVICES_HOST || true; }

# ---------------------------------------------------------------------------
# Registry persistence (.env.core WORKER_N block + optional flags in worker env)
# ---------------------------------------------------------------------------
fleet_load() {
  WORKERS=()
  local tmp line key idx hp host port mem cpu loc
  tmp="$(mktemp)"
  awk -F= '/^WORKER_[0-9]+=/ {print}' "$CORE_ENV" 2>/dev/null \
    | sort -t_ -k3,3n > "$tmp" || true
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    key="${line%%=*}"; hp="${line#*=}"
    idx="${key#WORKER_}"
    host="${hp%%:*}"; port="${hp##*:}"
    if ! [[ "$idx" =~ ^[0-9]+$ ]]; then log_warn "skipping malformed: $line"; continue; fi
    if ! [[ "$port" =~ ^[0-9]+$ ]]; then log_warn "skipping bad port: $line"; continue; fi
    mem="$(env_val "$WORKER_ENV" "WORKER_SHARD${idx}_MEMORY")"; mem="${mem:-$(global_memory)}"; mem="${mem:-512M}"
    cpu="$(env_val "$WORKER_ENV" "WORKER_SHARD${idx}_CPU")";     cpu="${cpu:-$(global_cpus)}";     cpu="${cpu:-0.5}"
    loc="$(env_val "$WORKER_ENV" "WORKER_SHARD${idx}_LOCAL")";   loc="${loc:-1}"
    WORKERS+=("$idx|$host|$port|$loc|$mem|$cpu")
  done < "$tmp"
  rm -f "$tmp"
}

fleet_save() {  # rewrites WORKER_N block in .env.core, preserves everything else
  [ -f "$CORE_ENV" ] || die "$CORE_ENV missing"
  local tmp row s h p l m c wtmp
  tmp="$(mktemp)"
  grep -v '^WORKER_[0-9]*=' "$CORE_ENV" > "$tmp"
  for row in "${WORKERS[@]}"; do
    IFS='|' read -r s h p l m c <<<"$row"
    echo "WORKER_$s=$h:$p" >> "$tmp"
  done
  mv "$tmp" "$CORE_ENV"

  if [ -f "$WORKER_ENV" ]; then
    wtmp="$(mktemp)"
    grep -vE '^WORKER_SHARD[0-9]+_(LOCAL|MEMORY|CPU)=' "$WORKER_ENV" > "$wtmp" || true
    local gm gc; gm="$(global_memory)"; gc="$(global_cpus)"
    for row in "${WORKERS[@]}"; do
      IFS='|' read -r s h p l m c <<<"$row"
      [ "$l" != "1" ] && echo "WORKER_SHARD${s}_LOCAL=$l" >> "$wtmp"
      [ -n "$gm" ] && [ "$m" != "$gm" ] && echo "WORKER_SHARD${s}_MEMORY=$m" >> "$wtmp"
      [ -n "$gc" ] && [ "$c" != "$gc" ] && echo "WORKER_SHARD${s}_CPU=$c" >> "$wtmp"
    done
    mv "$wtmp" "$WORKER_ENV"
  fi
}

require_env_files() {
  [ -f "$CORE_ENV" ] || die "$CORE_ENV missing — run ./cms first"
  [ -f "$WORKER_ENV" ] || die "$WORKER_ENV missing — run ./cms first"
}

# ---------------------------------------------------------------------------
# Status (container state + health)
# ---------------------------------------------------------------------------
worker_status() {
  local s="$1" cname="cms-worker-$s" st health
  st="$(docker inspect -f '{{.State.Status}}' "$cname" 2>/dev/null | tr -d '[:space:]')"
  [ -z "$st" ] && st="absent"
  case "$st" in
    running)
      health="$(docker inspect -f '{{if .Config.Healthcheck}}{{.State.Health.Status}}{{else}}none{{end}}' "$cname" 2>/dev/null | tr -d '[:space:]')"
      [ -z "$health" ] && health="none"
      case "$health" in
        healthy)   printf '%s● UP%s' "$C_G" "$C_0" ;;
        starting)  printf '%s◐ STARTING%s' "$C_Y" "$C_0" ;;
        unhealthy) printf '%s▲ UNHEALTHY%s' "$C_R" "$C_0" ;;
        *)         printf '%s● UP%s' "$C_G" "$C_0" ;;
      esac ;;
    exited|dead) printf '%s▲ EXITED%s' "$C_R" "$C_0" ;;
    absent)      printf '%s○ -%s' "$C_DIM" "$C_0" ;;
    *)           printf '%s◐ %s%s' "$C_Y" "$st" "$C_0" ;;
  esac
}

# ---------------------------------------------------------------------------
# Deployment — one compose project per local shard
# ---------------------------------------------------------------------------
deploy_worker() {
  local row="$1" s h p l m c proj
  IFS='|' read -r s h p l m c <<<"$row"
  if [ "$l" != "1" ]; then
    log_info "shard $s is registry-only (REMOTE) — skipping local deploy"
    return 0
  fi
  proj="cw$s"
  log_info "Deploying worker shard $s (port $p, mem $m, cpus $c, project $proj) ..."
  WORKER_SHARD="$s" WORKER_NAME="worker-$s" WORKER_PORT="$p" \
  WORKER_MEMORY_LIMIT="$m" WORKER_CPU_LIMIT="$c" WORKER_REPLICAS=1 \
  docker compose -p "$proj" -f docker-compose.yml --profile worker up -d --no-build \
    || { log_warn "worker shard $s failed to come up (see output above)"; return 1; }
  log_info "Worker shard $s deployed: cms-worker-$s on :$p"
}

stop_worker() {
  local row="$1" s h p l m c proj
  IFS='|' read -r s h p l m c <<<"$row"
  proj="cw$s"
  log_info "Stopping worker shard $s ..."
  docker compose -p "$proj" -f docker-compose.yml --profile worker down --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "cms-worker-$s" >/dev/null 2>&1 || true
  log_info "Worker shard $s stopped."
}

seed_if_empty() {
  fleet_load
  [ "${#WORKERS[@]}" -gt 0 ] && return 0
  # First run: migrate the existing single-worker config into entry 0.
  local p
  p="$(env_val "$WORKER_ENV" WORKER_PORT)"; p="${p:-26000}"
  WORKERS=("0|0.0.0.0|$p|1|$(global_memory || echo 512M)|$(global_cpus || echo 0.5)")
  fleet_save
  log_info "Seeded registry entry WORKER_0=0.0.0.0:$p into $CORE_ENV"
  log_info "Run 'make env' next so config/cms.toml picks it up."
}

cmd_deploy() {
  require_env_files
  seed_if_empty
  local target="${1:-all}" rc=0 row s hit w_list
  local -a want=()
  if [ "$target" != "all" ]; then
    w_list="$(expand_spec "$target")" || { log_warn "bad shard spec: $target"; return 1; }
    mapfile -t want <<< "$w_list"
  fi
  for row in "${WORKERS[@]}"; do
    s="${row%%|*}"
    if [ "$target" != all ]; then
      hit=0
      for w in "${want[@]}"; do [ "$s" = "$w" ] && hit=1; done
      [ "$hit" = 1 ] || continue
    fi
    deploy_worker "$row" || rc=1
  done
  return "$rc"
}

cmd_stop() {
  require_env_files; fleet_load
  local target="${1:-all}" row s hit w_list
  local -a want=()
  if [ "$target" != "all" ]; then
    w_list="$(expand_spec "$target")" || { log_warn "bad shard spec: $target"; return 1; }
    mapfile -t want <<< "$w_list"
  fi
  for row in ${WORKERS[@]+"${WORKERS[@]}"}; do
    s="${row%%|*}"
    if [ "$target" != all ]; then
      hit=0
      for w in "${want[@]}"; do [ "$s" = "$w" ] && hit=1; done
      [ "$hit" = 1 ] || continue
    fi
    stop_worker "$row"
  done
}

refresh_hint() {
  echo ""
  log_info "Registry changed -> run 'make env' (or ./cms) to regenerate config/cms.toml."
}

next_free_shard() {
  local used=" " s row
  for row in "${WORKERS[@]}"; do used+=" ${row%%|*} "; done
  s=0
  while [[ "$used" == *" $s "* ]]; do s=$((s+1)); done
  echo "$s"
}

# Expand "4", "4,5,6,7", "4-7" or "4,6-8" into a sorted, deduplicated list
# (one number per line). Fails on anything else.
expand_spec() {
  local spec="${1// /}"
  [ -n "$spec" ] || return 1
  (
    set -f
    IFS=','
    local -a out=()
    local item a b
    for item in $spec; do
      if [[ "$item" =~ ^([0-9]+)-([0-9]+)$ ]]; then
        a="${BASH_REMATCH[1]}"; b="${BASH_REMATCH[2]}"
        [ "$a" -le "$b" ] || exit 1
        while [ "$a" -le "$b" ]; do out+=("$a"); a=$((a+1)); done
      elif [[ "$item" =~ ^[0-9]+$ ]]; then
        out+=("$item")
      else
        exit 1
      fi
    done
    [ "${#out[@]}" -gt 0 ] || exit 1
    printf '%s\n' "${out[@]}" | sort -n -u
  )
}

# Ports for an attach batch: a single number is the base port (one per shard,
# incrementing); a range or comma list must resolve to exactly #shards ports.
resolve_ports() {
  local spec="${1// /}" count="$2" base i
  [ -n "$spec" ] && [ -n "$count" ] || return 1
  if [[ "$spec" == *-* || "$spec" == *,* ]]; then
    expand_spec "$spec" || return 1
  else
    [[ "$spec" =~ ^[0-9]+$ ]] || return 1
    base="$spec"
    [ "$base" -ge 1 ] && [ "$base" -le 65535 ] || return 1
    i=0
    while [ "$i" -lt "$count" ]; do
      [ "$((base + i))" -le 65535 ] || return 1
      echo "$((base + i))"
      i=$((i+1))
    done
  fi
}

add_entry() {
  local s h p m c
  fleet_load; s="$(next_free_shard)"
  if ui_form_edit "New worker shard" \
      "shard|Shard|$s" \
      "port|Port|$((26000 + s))" \
      "host|Registry host|$(core_host_ip)" \
      "memory|Memory|$(global_memory || echo 512M)" \
      "cpus|CPUs|$(global_cpus || echo 0.5)"; then
    s="$FORM_OUT_shard"; h="$FORM_OUT_host"; p="$FORM_OUT_port"; m="$FORM_OUT_memory"; c="$FORM_OUT_cpus"
    [[ "$s" =~ ^[0-9]+$ ]] || { log_warn "shard must be numeric"; return 0; }
    [[ "$p" =~ ^[0-9]+$ ]] || { log_warn "port must be numeric"; return 0; }
    fleet_load; WORKERS+=("$s|$h|$p|1|$m|$c"); fleet_save
    log_info "Added shard $s ($h:$p). Run 'make env' to refresh cms.toml."
  fi
}

edit_entry() {
  fleet_load
  local row="${WORKERS[$CUR]}" s h p l m c
  IFS='|' read -r s h p l m c <<<"$row"
  if ui_form_edit "Edit shard $s" \
      "shard|Shard|$s" \
      "port|Port|$p" \
      "host|Registry host|$h" \
      "memory|Memory|$m" \
      "cpus|CPUs|$c"; then
    s="$FORM_OUT_shard"; h="$FORM_OUT_host"; p="$FORM_OUT_port"; m="$FORM_OUT_memory"; c="$FORM_OUT_cpus"
    [[ "$s" =~ ^[0-9]+$ ]] || { log_warn "shard must be numeric"; return 0; }
    [[ "$p" =~ ^[0-9]+$ ]] || { log_warn "port must be numeric"; return 0; }
    WORKERS[$CUR]="$s|$h|$p|$l|$m|$c"; fleet_save
    log_info "Updated shard $s ($h:$p). Re-deploy to apply."
  fi
}

# Attach a remote worker box: write its shards into the registry as
# registry-only (LOCAL=0) rows the core routes to, then print the block to
# run on the worker box (same rows, no LOCAL override → deploy locally there).
attach_entry() {  # [shard-spec host port-spec] — prompts when args are omitted
  require_env_files
  local spec="$1" host="$2" pspec="$3"
  if [ -z "$spec" ] || [ -z "$host" ] || [ -z "$pspec" ]; then
    [ -t 0 ] && [ -t 1 ] || die "usage: $0 attach <shard-spec> <host> <port-spec>"
    printf 'Shards to attach (e.g. 4,5,6,7 or 4-7): '
    IFS= read -r spec || return 0
    printf 'Worker box host/IP for the core to reach it on: '
    IFS= read -r host || return 0
    printf 'Ports (base e.g. 26004, or explicit 26004-26007): '
    IFS= read -r pspec || return 0
  fi
  local s_list p_list
  s_list="$(expand_spec "$spec")" || { log_warn "bad shard spec: $spec"; return 1; }
  local -a shards=() ports=()
  mapfile -t shards <<< "$s_list"
  p_list="$(resolve_ports "$pspec" "${#shards[@]}")" || {
    log_warn "bad port spec: $pspec"; return 1; }
  mapfile -t ports <<< "$p_list"
  if [ "${#ports[@]}" -ne "${#shards[@]}" ]; then
    log_warn "got ${#ports[@]} port(s) for ${#shards[@]} shard(s)"
    return 1
  fi
  [ -n "$host" ] || { log_warn "host required"; return 1; }
  local i p
  for i in "${shards[@]}"; do
    [ "$i" -ge 0 ] || { log_warn "shard must be >= 0: $i"; return 1; }
  done
  for p in "${ports[@]}"; do
    { [ "$p" -ge 1 ] && [ "$p" -le 65535 ]; } || { log_warn "port out of range: $p"; return 1; }
  done
  local gm gc row s keep
  gm="$(global_memory)"; gc="$(global_cpus)"
  fleet_load
  local -a kept=() added=()
  for row in ${WORKERS[@]+"${WORKERS[@]}"}; do
    s="${row%%|*}"; keep=1
    for i in "${shards[@]}"; do [ "$s" = "$i" ] && keep=0; done
    if [ "$keep" = 1 ]; then kept+=("$row"); else log_info "Replacing registry row for shard $s"; fi
  done
  for i in "${!shards[@]}"; do
    added+=("${shards[$i]}|$host|${ports[$i]}|0|${gm:-512M}|${gc:-0.5}")
  done
  WORKERS=(${kept[@]+"${kept[@]}"} ${added[@]+"${added[@]}"})
  fleet_save
  log_info "Attached ${#shards[@]} shard(s) as registry-only rows (LOCAL=0):"
  for i in "${!shards[@]}"; do
    printf '  WORKER_%s=%s:%s\n' "${shards[$i]}" "$host" "${ports[$i]}"
  done
  refresh_hint
  echo ""
  log_info "On the worker box ($host), from its cms-docker checkout:"
  echo "  # needs a checkout whose './cms config sync' preserves WORKER_N rows"
  echo "  cat >> .env.core <<'FLEET'"
  for i in "${!shards[@]}"; do
    printf 'WORKER_%s=%s:%s\n' "${shards[$i]}" "$host" "${ports[$i]}"
  done
  echo "  FLEET"
  echo "  ./cms config sync && ./cms worker deploy all && ./cms worker list"
}

render() {
  fleet_load
  local i=0 row s h p l m c st mark x scope
  printf '%sCMS Worker Fleet%s  (registry: %s · defaults: %s)\n' "$C_B" "$C_0" "$CORE_ENV" "$WORKER_ENV"
  printf ' %-4s %-5s %-11s %-24s %-6s %-10s %-6s %-7s %s\n' "sel" "shard" "state" "host" "port" "mem" "cpus" "scope" ""
  for row in "${WORKERS[@]}"; do
    IFS='|' read -r s h p l m c <<<"$row"
    st="$(worker_status "$s")"
    if [ "$l" = "1" ]; then scope="local"; else scope="${C_DIM}remote${C_0}"; fi
    mark=" "
    [ "$i" = "$CUR" ] && mark=">"
    if [ "${#SELECTED[@]}" -gt 0 ]; then
      for x in "${SELECTED[@]}"; do [ "$x" = "$i" ] && mark="*"; done
    fi
    [ "$mark" = ">" ] && printf '%s' "$C_B"
    printf ' %-4s %-5s %-11b %-24s %-6s %-10s %-6s %-7b cms-worker-%s%s\n' \
      "$mark" "$s" "$st" "$h" "$p" "$m" "$c" "$scope" "$s" "$C_0"
    i=$((i+1))
  done
  [ "${#WORKERS[@]}" -eq 0 ] && printf ' %s(no entries — press a to add)%s\n' "$C_DIM" "$C_0"
  echo ""
  echo " ↑↓ move · space select · a add · A attach remote box · e edit · d delete · D deploy sel/all · K stop · L logs · r refresh · q quit"
}

tui_loop() {
  while true; do
    clear 2>/dev/null || true
    render
    local key esc x hit out q ls row ds yn=""
    if ! IFS= read -rsn1 key; then key=q; fi
    if [ "$key" = $'\x1b' ]; then
      esc=""
      IFS= read -rsn2 -t 0.05 esc || true
      case "$esc" in
        '[A') [ "$CUR" -gt 0 ] && CUR=$((CUR-1)) || true ;;
        '[B') fleet_load || true
              { [ "${#WORKERS[@]}" -gt 0 ] && [ "$CUR" -lt $((${#WORKERS[@]}-1)) ]; } && CUR=$((CUR+1)) || true ;;
      esac
      continue
    fi
    case "$key" in
      j) fleet_load || true; { [ "${#WORKERS[@]}" -gt 0 ] && [ "$CUR" -lt $((${#WORKERS[@]}-1)) ]; } && CUR=$((CUR+1)) || true ;;
      k) [ "$CUR" -gt 0 ] && CUR=$((CUR-1)) || true ;;
      " ")
        fleet_load || true
        if [ "${#WORKERS[@]}" -gt 0 ]; then
          hit=0
          for x in ${SELECTED[@]+"${SELECTED[@]}"}; do [ "$x" = "$CUR" ] && hit=1 && break; done
          if [ "$hit" = 1 ]; then
            out=(); for x in ${SELECTED[@]+"${SELECTED[@]}"}; do [ "$x" != "$CUR" ] && out+=("$x"); done
            SELECTED=(${out[@]+"${out[@]}"})
          else
            SELECTED+=("$CUR")
          fi
        fi ;;
      a) add_entry ;;
      A) attach_entry "" "" "" || true ;;
      e) fleet_load || true; { [ "${#WORKERS[@]}" -gt 0 ] && edit_entry "$CUR"; } ;;
      d)
        fleet_load || true
        if [ "${#WORKERS[@]}" -gt 0 ]; then
          row="${WORKERS[$CUR]}"; ds="${row%%|*}"
          printf 'Delete shard %s? (stops its container too) [y/N] ' "$ds"
          IFS= read -r yn || true
          if [[ "$yn" =~ ^[Yy] ]]; then
            stop_worker "$row" >/dev/null 2>&1 || true
            out=(); q=0
            for x in "${WORKERS[@]}"; do [ "$q" != "$CUR" ] && out+=("$x"); q=$((q+1)); done
            WORKERS=(${out[@]+"${out[@]}"}); fleet_save
            if [ "$CUR" -ge "${#WORKERS[@]}" ] && [ "$CUR" -gt 0 ]; then CUR=$((CUR-1)); fi
            refresh_hint
          fi
        fi ;;
      D)
        fleet_load || true
        if [ "${#SELECTED[@]}" -gt 0 ]; then
          for x in ${SELECTED[@]+"${SELECTED[@]}"}; do deploy_worker "${WORKERS[$x]}" || true; done
          SELECTED=()
        else
          cmd_deploy all || true
        fi
        printf '\nPress any key...'
        IFS= read -rsn1 || true ;;
      K)
        fleet_load || true
        { [ "${#WORKERS[@]}" -gt 0 ] && stop_worker "${WORKERS[$CUR]}"; } || true
        printf '\nPress any key...'
        IFS= read -rsn1 || true ;;
      L)
        fleet_load || true
        ls="${WORKERS[$CUR]%%|*}"
        clear 2>/dev/null || true
        docker logs --tail 60 "cms-worker-$ls" 2>&1 || echo "(no logs yet for cms-worker-$ls)"
        printf '\nPress any key...'
        IFS= read -rsn1 || true ;;
      r) : ;;
      q|Q) clear 2>/dev/null || true; exit 0 ;;
    esac
  done
}

list_plain() {
  require_env_files; fleet_load
  printf '%-6s %-24s %-6s %-7s %-10s %-6s %s\n' "shard" "host" "port" "scope" "memory" "cpus" "state"
  local row s h p l m c
  for row in "${WORKERS[@]}"; do
    IFS='|' read -r s h p l m c <<<"$row"
    printf '%-6s %-24s %-6s %-7s %-10s %-6s %b\n' "$s" "$h" "$p" \
      "$([ "$l" = "1" ] && echo local || echo remote)" "$m" "$c" "$(worker_status "$s")"
  done
}

case "${1:-tui}" in
  tui)
    [ -t 0 ] && [ -t 1 ] || die "interactive TUI needs a terminal — use: $0 deploy|stop|list"
    require_env_files
    tui_loop ;;
  attach)
    shift
    attach_entry "${1:-}" "${2:-}" "${3:-}" ;;
  deploy) cmd_deploy "${2:-all}" ;;
  stop)   cmd_stop "${2:-all}" ;;
  list)   list_plain ;;
  *) die "usage: $0 [tui|attach [spec host port-spec]|deploy [all|shard|spec]|stop [all|shard|spec]|list]" ;;
esac
