#!/bin/bash
# Emit live worker detail as JSON for dashboards (admin panel /deployments).
#
# Sources (no phantom tables): docker inspect (state/health/uptime/restarts),
# container logs (activity classification), .env.contest (assigned contest),
# TCP probe (reachability incl. remote workers), cms.toml registry via
# scripts/__worker_tui.sh fleet semantics (WORKER_N in .env.core).
#
# Usage:
#   __worker_status_json.sh [--pretty]

set -euo pipefail
cd "$(dirname "$0")/.."

CORE_ENV=".env.core"
CONTEST_ENV=".env.contest"

env_val() { awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true; }

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ' | sed 's/[[:cntrl:]]//g'; }

tcp_probe() { # host port -> 0 if connectable within 2s
  local h="$1" p="$2"
  (timeout 2 bash -c "</dev/tcp/$h/$p") >/dev/null 2>&1
}

classify_activity() { # last-log-line -> state word
  local l="${1,,}"
  case "$l" in
    *got*submission*|*executing*|*compil*|*evaluat*) echo working ;;
    *connect*)                                       echo connecting ;;
    *error*|*traceback*|*refused*|*failed*)          echo erroring ;;
    *)                                               echo idle ;;
  esac
}

worker_row() { # shard host port
  local s="$1" h="$2" p="$3"
  local cname="cms-worker-$s"
  local raw st health started restarts uptime="" lastlog="" act="unknown" reach=false contest
  contest="$(env_val "$CONTEST_ENV" CONTEST_ID)"
  raw="$(docker inspect -f '{{.State.Status}}|{{if .Config.Healthcheck}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.StartedAt}}|{{.RestartCount}}' "$cname" 2>/dev/null || true)"
  if [ -z "$raw" ]; then st="absent"; health="none"; else
    IFS='|' read -r st health started restarts <<<"$raw"
    if [ "$st" = running ] && command -v date >/dev/null; then
      local secs
      secs=$(( $(date +%s) - $(date -d "${started%%.*}" +%s 2>/dev/null || echo 0) ))
      uptime="${secs}s"
    fi
    lastlog="$(docker logs --tail 5 "$cname" 2>&1 | grep -v '^$' | tail -1 || true)"
    act="$(classify_activity "$lastlog")"
  fi
  if tcp_probe "$h" "$p"; then reach=true; fi
  printf '{"shard":%s,"name":"%s","endpoint":"%s:%s","contest":%s,"state":"%s","health":"%s","restarts":%s,"uptime":"%s","activity":"%s","lastLog":"%s","reachable":%s}' \
    "${s:-null}" "$(json_escape "$cname")" "$(json_escape "$h")" "$(json_escape "$p")" \
    "${contest:-null}" "$(json_escape "$st")" "$(json_escape "$health")" \
    "${restarts:-0}" "$(json_escape "$uptime")" "$act" "$(json_escape "$lastlog")" \
    "$reach"
}

rows=()
tmp="$(mktemp)"
awk -F= '/^WORKER_[0-9]+=/ {print}' "$CORE_ENV" 2>/dev/null | sort -t_ -k3,3n > "$tmp" || true
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  key="${line%%=*}"; hp="${line#*=}"
  s="${key#WORKER_}"; h="${hp%%:*}"; p="${hp##*:}"
  [[ "$p" =~ ^[0-9]+$ ]] || continue
  rows+=("$(worker_row "$s" "$h" "$p")")
done < "$tmp"
rm -f "$tmp"

out="["
for ((i=0; i<${#rows[@]}; i++)); do
  [ "$i" -gt 0 ] && out+=","
  out+="${rows[$i]}"
done
out+="]"

if [ "${1:-}" = "--pretty" ]; then
  printf '%s' "$out" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$out"
else
  printf '%s\n' "$out"
fi
