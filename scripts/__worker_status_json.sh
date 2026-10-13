#!/bin/bash
# Emit live worker detail as JSON for dashboards (admin panel /deployments).
#
# Sources (no phantom tables): docker inspect (state/health/uptime/restarts),
# container logs (activity classification), the fleet and the assigned contest read
# environment-first from config.toml [worker]/[contest] and then .env, TCP probe
# (reachability incl. remote workers), cms.toml registry via scripts/__worker_tui.sh
# fleet semantics.
#
# Usage:
#   __worker_status_json.sh [--pretty]

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi
cd "$(dirname "$0")/.."

CORE_ENV=".env"
CONFIG_TOML="config.toml"

# Trim leading and trailing whitespace off one string.
trim_ws() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  printf '%s' "${s%"${s##*[![:space:]]}"}"
}

# Raw right-hand side -> bare value: one layer of quotes and a trailing comment
# dropped, matching row_value in scripts/__worker_tui.sh so the two agree on a row.
row_value() {
  local v
  v="$(trim_ws "${1%%#*}")"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  trim_ws "$v"
}

# Emit "key<TAB>raw-value" for every key of one config.toml section, so a caller
# decodes only the rows it wants. Mirrors registry_keys in scripts/__worker_tui.sh.
toml_rows() { # section
  local want="$1" line trimmed section="" key
  [ -f "$CONFIG_TOML" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    trimmed="$(trim_ws "$line")"
    case "$trimmed" in
      '['*']') section="${trimmed#\[}"; section="${section%\]}"; continue ;;
    esac
    [ "$section" = "$want" ] || continue
    key="$(trim_ws "${trimmed%%=*}")"
    printf '%s\t%s\n' "$key" "${trimmed#*=}"
  done < "$CONFIG_TOML"
}

# One value out of one config.toml section; "" when the section or key is absent.
toml_val() { # section key
  local want="$2" key raw
  while IFS=$'\t' read -r key raw; do
    [ "$key" = "$want" ] || continue
    row_value "$raw"
    return 0
  done < <(toml_rows "$1")
}

# config.toml [worker] rows as "WORKER_<n>=host:port" — the source .env is rendered from.
toml_worker_lines() {
  local key raw
  while IFS=$'\t' read -r key raw; do
    [[ "$key" =~ ^WORKER_[0-9]+$ ]] || continue
    printf '%s=%s\n' "$key" "$(row_value "$raw")"
  done < <(toml_rows "worker")
}

# Why the environment wins: inside the panel container .env is unreadable and the value it was given lives here.
# Why config.toml before .env: config.toml is the source scripts/__config_sync.sh renders .env from, so
# .env is only that copy — the last resort for a host that has no config.toml.
env_val() { # key toml-section -> the environment's value, else config.toml's, else .env's
  local key="$1" section="$2" from_environment="${!1-}" v
  if [ -n "$from_environment" ]; then printf '%s\n' "$from_environment"; return 0; fi
  v="$(toml_val "$section" "$key")"
  if [ -n "$v" ]; then printf '%s\n' "$v"; return 0; fi
  awk -F= -v k="$key" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$CORE_ENV" 2>/dev/null || true
}

# Why both sources: a fleet a container was given lives only in its environment when .env is unreadable.
worker_lines() {
  { env | grep -E '^WORKER_[0-9]+=' || true
    toml_worker_lines
    awk -F= '/^WORKER_[0-9]+=/ {print}' "$CORE_ENV" 2>/dev/null || true
  } | awk -F= '!seen[$1]++' | sort -t_ -k3,3n
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ' | sed 's/[[:cntrl:]]//g'; }

tcp_probe() { # host port -> 0 if connectable within 2s
  local h="$1" p="$2"
  (timeout 2 bash -c "</dev/tcp/$h/$p") >/dev/null 2>&1
}

# Local-address matcher, kept in lockstep with is_local_host in
# scripts/__worker_tui.sh:156 — the TUI binds the rows this script labels, so
# a disagreement would flip a worker between "absent" and "remote".
is_local_host() {
  local h="$1" ip
  case "$h" in
    0.0.0.0|127.0.0.1|localhost) return 0 ;;
  esac
  [ "$h" = "$(hostname -s 2>/dev/null)" ] && return 0
  [ "$h" = "$(hostname -f 2>/dev/null)" ] && return 0
  for ip in $(hostname -I 2>/dev/null); do [ "$h" = "$ip" ] && return 0; done
  return 1
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
  local raw="" st health started restarts uptime="" lastlog="" act="unknown" reach=false contest
  local is_local=false
  contest="$(env_val CONTEST_ID contest)"
  # A container exists only on the box its row addresses, so the local daemon
  # is queried for local rows only; for a remote row its empty answer means
  # "not here", not "not deployed".
  if is_local_host "$h"; then
    is_local=true
    raw="$(docker inspect -f '{{.State.Status}}|{{if .Config.Healthcheck}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.StartedAt}}|{{.RestartCount}}' "$cname" 2>/dev/null || true)"
  fi
  if [ -z "$raw" ]; then
    health="none"
    # absent = should have been deployed here and was not; remote = lives on
    # another box, where reachability is the only truthful liveness signal.
    if [ "$is_local" = true ]; then st="absent"; else st="remote"; fi
  else
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
worker_lines > "$tmp"
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
