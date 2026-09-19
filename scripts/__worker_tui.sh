#!/bin/bash
# Worker fleet TUI — manage the WORKER_<shard>=<host>:<port> registry in
# .env and deploy each local entry as its own compose project
# (cms-worker-<shard>, host port <port>).
#
# Data model (backward compatible):
#   .env        : WORKER_<shard>=host:port      <- registry, rendered into
#                                                  config/cms.toml by make env
#   .env        : all existing vars untouched    <- per-host worker defaults
#                 WORKER_SHARD<n>_LOCAL=0        <- OPTIONAL: registry-only,
#                                                 skip local deployment
#                 WORKER_SHARD<n>_MEMORY/_CPU    <- OPTIONAL per-shard overrides
#
# Usage:
#   scripts/__worker_tui.sh                              interactive TUI (tty)
#   scripts/__worker_tui.sh attach [spec host port-spec [main-ip]] attach a remote
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
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

CORE_ENV=".env"
WORKER_ENV=".env"

WORKERS=()      # rows: "shard|host|port|local(1/0)|memory|cpus"
CUR=0
SELECTED=()

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/__lib/common.sh"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/__lib/form.sh" ] && source "${SCRIPT_DIR}/__lib/form.sh"

C_DIM=$'\033[2m'; C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'

env_val() { # file key -> value (exact key match, first hit)
  awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

global_memory() { env_val "$WORKER_ENV" WORKER_MEMORY_LIMIT || true; }
global_cpus()   { env_val "$WORKER_ENV" WORKER_CPU_LIMIT   || true; }
core_host_ip()  { env_val "$CORE_ENV"   CORE_SERVICES_HOST || true; }

toml_val() { # key -> value from config.toml (first hit, quotes stripped)
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*[\"']\\{0,1\\}\\([^\"'#]*\\)[\"']\\{0,1\\}.*/\\1/p" config.toml 2>/dev/null | head -n 1
}

# IP the workers must dial to reach this main server: explicit Tailscale IP
# first, else the first non-loopback address. Empty when undeterminable.
main_reachable_ip() {
  local ip
  ip="$(toml_val TAILSCALE_IP)"
  if [ -n "$ip" ]; then printf '%s' "$ip"; return 0; fi
  ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | grep -v '^::1' | head -n 1 || true)"
  printf '%s' "${ip:-}"
}

# ---------------------------------------------------------------------------
# Registry persistence (.env WORKER_N block + optional flags in worker env)
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

fleet_save() {  # updates config.toml [worker] with fleet rows, re-runs sync
  local toml="config.toml"
  [ -f "$toml" ] || log_die "config.toml missing — run ./cms first"
  local row s h p l m c
  local gm gc; gm="$(global_memory)"; gc="$(global_cpus)"

  local fleet_block=""
  for row in "${WORKERS[@]}"; do
    IFS='|' read -r s h p l m c <<<"$row"
    fleet_block+="WORKER_${s} = \"${h}:${p}\"\n"
    if [ "$l" != "1" ]; then
      fleet_block+="WORKER_SHARD${s}_LOCAL = ${l}\n"
    fi
    [ -n "$gm" ] && [ "$m" != "$gm" ] && fleet_block+="WORKER_SHARD${s}_MEMORY = \"${m}\"\n"
    [ -n "$gc" ] && [ "$c" != "$gc" ] && fleet_block+="WORKER_SHARD${s}_CPU = \"${c}\"\n"
  done

  # Update config.toml: remove old fleet entries, insert new ones under [worker].
  # WHY: fleet rows end in a double quote (WORKER_0 = "0.0.0.0:26000"), so embedding
  # the block in a Python literal terminated that literal early and broke the deploy.
  # Pass it as data through the environment (same channel the other scripts use for
  # values — see __inject_config.sh: "secrets via env, never argv"), and quit the
  # heredoc so the program is never subject to shell interpolation either.
  FLEET_BLOCK="$(printf '%b' "$fleet_block")" python3 - "$toml" <<'PYEOF'
import os
import re
import sys
from pathlib import Path

toml_path = sys.argv[1]
fleet_text = os.environ.get("FLEET_BLOCK", "")

text = Path(toml_path).read_text()
lines = text.splitlines()
new_lines = []
in_worker = False

for line in lines:
    stripped = line.strip()
    if stripped.startswith('[') and stripped.endswith(']'):
        in_worker = (stripped == '[worker]')
        new_lines.append(line)
        continue
    if in_worker:
        key = stripped.split('=')[0].strip() if '=' in stripped else ''
        if re.match(r'^WORKER_\d+$', key) or re.match(r'^WORKER_SHARD\d+_(LOCAL|MEMORY|CPU)$', key):
            continue  # Skip old fleet entries
    new_lines.append(line)

# Find insertion point: last non-empty line in [worker] section
insert_idx = len(new_lines)
in_worker = False
for i, line in enumerate(new_lines):
    stripped = line.strip()
    if stripped == '[worker]':
        in_worker = True
        continue
    if in_worker:
        if stripped.startswith('[') and stripped.endswith(']'):
            insert_idx = i
            break
        if stripped and not stripped.startswith('#'):
            insert_idx = i + 1

fleet_lines = [l for l in fleet_text.strip().splitlines() if l.strip()]
for j, fl in enumerate(fleet_lines):
    new_lines.insert(insert_idx + j, fl)

Path(toml_path).write_text('\n'.join(new_lines) + '\n')
PYEOF

  # WHY not 2>/dev/null: that discards the sync's own [WARN]/[ERROR] lines and
  # preflight failures, so a failure arrives with no stated cause.
  bash scripts/__config_sync.sh --no-secrets || log_warn "config sync after fleet_save failed"
}

require_env_files() {
  [ -f "$CORE_ENV" ] || log_die "$CORE_ENV missing — run ./cms config sync first"
  [ -f "config.toml" ] || log_die "config.toml missing — run ./cms config sync first"
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
  log_info "Registry saved to config.toml — .env refreshed automatically (no manual step)."
}

next_free_shard() {
  # Suggest max(existing)+1: remote fleets use sparse shard numbers
  # (e.g. 10, 11, 12), so a first-gap suggestion would offer 0.
  local max=0 s row
  for row in ${WORKERS[@]+"${WORKERS[@]}"}; do
    s="${row%%|*}"
    [ "$s" -gt "$max" ] && max="$s"
  done
  echo "$((max + 1))"
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
    log_info "Added shard $s ($h:$p)."
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
attach_entry() {  # [shard-spec host port-spec [main-ip]] — prompts when args are omitted
  require_env_files
  local spec="$1" host="$2" pspec="$3" main="$4"
  if [ -z "$spec" ] || [ -z "$host" ] || [ -z "$pspec" ]; then
    [ -t 0 ] && [ -t 1 ] || log_die "usage: $0 attach <shard-spec> <host> <port-spec> [main-ip]"
    printf 'Shards to attach (e.g. 4,5,6,7 or 4-7): '
    IFS= read -r spec || return 0
    printf 'Worker box host/IP for the core to reach it on: '
    IFS= read -r host || return 0
    printf 'Ports (base e.g. 26004, or explicit 26004-26007): '
    IFS= read -r pspec || return 0
  fi
  if [ -z "$main" ]; then
    local guess
    guess="$(main_reachable_ip)"
    if [ -t 0 ] && [ -t 1 ]; then
      printf 'Main server IP the workers must dial [%s]: ' "$guess"
      IFS= read -r main || return 0
      [ -z "$main" ] && main="$guess"
    else
      main="$guess"
    fi
  fi
  if [ -z "$main" ] || [[ "$main" =~ [[:space:]:] ]]; then
    log_warn "main server IP required (no whitespace or ':') — set TAILSCALE_IP in config.toml or pass it explicitly"
    return 1
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
  if [ -z "$host" ] || [[ "$host" =~ [[:space:]:] ]]; then
    log_warn "host required — no whitespace or ':' allowed"
    return 1
  fi
  local i p
  for i in "${shards[@]}"; do
    [ "$i" -ge 0 ] || { log_warn "shard must be >= 0: $i"; return 1; }
  done
  for p in "${ports[@]}"; do
    { [ "$p" -ge 1 ] && [ "$p" -le 65535 ]; } || { log_warn "port out of range: $p"; return 1; }
  done
  attach_write_rows "$host" "${shards[@]}" --- "${ports[@]}" || return 1
  attach_print_block "$main" "$host" "${shards[@]}" --- "${ports[@]}"
}

# Replace the given shards' registry rows with LOCAL=0 entries and save.
# Uses "---" as a separator because shard and port lists are both numeric.
attach_write_rows() {
  local host="$1"; shift
  local -a shards=() ports=() kept=() added=()
  local arg
  while [ "$1" != "---" ]; do shards+=("$1"); shift; done
  shift
  for arg in "$@"; do ports+=("$arg"); done
  local gm gc row s keep i
  gm="$(global_memory)"; gc="$(global_cpus)"
  fleet_load
  for row in ${WORKERS[@]+"${WORKERS[@]}"}; do
    s="${row%%|*}"; keep=1
    for i in "${shards[@]}"; do [ "$s" = "$i" ] && keep=0; done
    if [ "$keep" = 1 ]; then kept+=("$row"); else log_info "Replacing registry row for shard $s"; fi
  done
  for i in "${!shards[@]}"; do
    added+=("${shards[$i]}|$host|${ports[$i]}|0|${gm:-512M}|${gc:-0.5}")
  done
  WORKERS=("${kept[@]+"${kept[@]}"}" "${added[@]+"${added[@]}"}")
  fleet_save
  log_info "Attached ${#shards[@]} shard(s) as registry-only rows (LOCAL=0):"
  for i in "${!shards[@]}"; do
    printf '  WORKER_%s=%s:%s\n' "${shards[$i]}" "$host" "${ports[$i]}"
  done
  refresh_hint
}

# Print the worker-side setup block (paste on the worker box).
# Why sed-append instead of a heredoc: the file ends in [tailscale], so
# appended WORKER lines would land in the wrong section (and a second
# [worker] header duplicates it). Appending under the existing header keeps
# every key in its section with no manual editing.
attach_print_block() {
  local main="$1"; shift
  local host="$1"; shift
  local -a shards=() ports=()
  while [ "$1" != "---" ]; do shards+=("$1"); shift; done
  shift
  local arg
  for arg in "$@"; do ports+=("$arg"); done
  local i
  echo ""
  log_info "On the worker box ($host), from a fresh checkout of this repository:"
  echo "  # 1) Point the worker at this main server (no manual editing)"
  echo "  sed -i 's|^CORE_SERVICES_HOST.*|CORE_SERVICES_HOST = \"$main\"|' config.toml"
  echo "  grep -q '^CORE_SERVICES_HOST' config.toml || echo 'CORE_SERVICES_HOST = \"$main\"' >> config.toml"
  echo "  # 2) Register this box's shards (appended under [worker])"
  printf '  sed -i \x27/^\\[worker\\]/a'
  for i in "${!shards[@]}"; do
    printf ' \\\n  WORKER_%s = \"%s:%s\"' "${shards[$i]}" "$host" "${ports[$i]}"
  done
  printf '\x27 config.toml\n'
  echo "  # 3) Confirm the core ports are reachable from here (all six must say open)"
  echo "  for p in 25000 28000 28500 29000 22000 28600; do timeout 3 bash -c \"</dev/tcp/$main/\$p\" && echo \"\$p open\" || echo \"\$p CLOSED\"; done"
  echo "  # 4) Cgroups, then start and verify"
  echo "  sudo ./scripts/__worker_cgroup_setup.sh /sys/fs/cgroup/cms-isolate"
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
    [ -t 0 ] && [ -t 1 ] || log_die "interactive TUI needs a terminal — use: $0 deploy|stop|list"
    require_env_files
    tui_loop ;;
  attach)
    shift
    attach_entry "${1:-}" "${2:-}" "${3:-}" "${4:-}" ;;
  deploy) cmd_deploy "${2:-all}" ;;
  stop)   cmd_stop "${2:-all}" ;;
  list)   list_plain ;;
  *) log_die "usage: $0 [tui|attach [spec host port-spec]|deploy [all|shard|spec]|stop [all|shard|spec]|list]" ;;
esac
