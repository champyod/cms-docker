#!/usr/bin/env bash
# scripts/__render_expose.sh — render docker-compose.expose.yml from the bind model.
#
# WHY a generated override: docker compose pins one host_ip per port entry, so a
# service that must answer on more than one address (a public IP and a tailnet IP,
# say) needs one entry per address, and a single ${VAR} cannot expand to several
# lines. The addresses are resolved here and the entries are written out.
#
# Resolution for each service, highest priority first:
#   1. <SVC>_BIND_IP   explicit bind (comma-separated list allowed) — wins outright
#   2. nothing set     -> the service keeps its compose default (not emitted)
#
# WHY one key per service and no system-wide fallback: a peer-facing service is named by
# INNER_IP and a front-door service by its own *_BIND_IP, so a port answers on an address
# only when the key owning that port names that address. A fallback would put the peer
# ports — postgres, the RPC services, the worker's 26000 — on whatever address was set for
# the web tier.
#
# Output uses Compose's `!override` tag, which replaces a service's ports list
# (a plain assignment appends, duplicating the mapping). Requires Compose >= 2.24.
#
# Usage: bash scripts/__render_expose.sh   (then bring a stack up as usual)
set -eu

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${REPO_ROOT}/docker-compose.expose.yml"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${REPO_ROOT}/.env" 2>/dev/null || true
  set +a
fi

resolve_ips() {
  local bind_key="$1"
  local explicit="${!bind_key:-}"
  if [[ -n "$explicit" ]]; then printf '%s\n' "$explicit"; fi
}

# service|host_port_var|default_host_port|container_port|bind_key
TABLE="$(cat <<'EOF'
database|POSTGRES_PORT_EXTERNAL|5432|5432|DB_BIND_IP
log-service|LOG_SERVICE_PORT_EXTERNAL|29000|29000|INNER_IP
resource-service|RESOURCE_SERVICE_PORT_EXTERNAL|28000|28000|INNER_IP
scoring-service|SCORING_SERVICE_PORT_EXTERNAL|28500|28500|INNER_IP
checker-service|CHECKER_SERVICE_PORT_EXTERNAL|22000|22000|INNER_IP
evaluation-service|EVALUATION_SERVICE_PORT_EXTERNAL|25000|25000|INNER_IP
proxy-service|PROXY_SERVICE_PORT_EXTERNAL|28600|28600|INNER_IP
contest-web-server|CONTEST_PORT_EXTERNAL|8888|8888|CONTEST_BIND_IP
nginx-proxy|NGINX_HTTP_PORT|80|80|NGINX_BIND_IP
nginx-proxy|NGINX_HTTPS_PORT|443|443|NGINX_BIND_IP
admin-panel-next|ADMIN_NEXT_PORT_EXTERNAL|8891|3000|ADMIN_NEXT_BIND_IP
admin-web-server|ADMIN_PORT_EXTERNAL|8889|8889|ADMIN_BIND_IP
ranking-web-server|RANKING_PORT_EXTERNAL|8890|8890|RANKING_BIND_IP
worker|WORKER_PORT|26000|26000|WORKER_BIND_ADDR
EOF
)"

declare -A SVC_PORTS=()
declare -a SVC_ORDER=()

while IFS='|' read -r svc port_var default_port container_port bind_key; do
  [[ -n "$svc" ]] || continue
  host_port="${!port_var:-$default_port}"
  mapfile -t ips < <(resolve_ips "$bind_key" | tr ',' '\n' | sed '/^[[:space:]]*$/d')
  (( ${#ips[@]} > 0 )) || continue
  if [[ -z "${SVC_PORTS[$svc]:-}" ]]; then SVC_ORDER+=("$svc"); fi
  for ip in "${ips[@]}"; do
    ip="${ip//[[:space:]]/}"
    SVC_PORTS[$svc]+="      - \"${ip}:${host_port}:${container_port}\""$'\n'
  done
done <<< "$TABLE"

if (( ${#SVC_ORDER[@]} == 0 )); then
  rm -f "$OUT"
  echo "render-expose: nothing to override (no bind address configured)"
  exit 0
fi

tmp="$(mktemp "${REPO_ROOT}/.expose.XXXXXX")"
{
  printf 'services:\n'
  for svc in "${SVC_ORDER[@]}"; do
    printf '  %s:\n    ports: !override\n' "$svc"
    printf '%s' "${SVC_PORTS[$svc]}"
  done
} > "$tmp"
mv -- "$tmp" "$OUT"
echo "render-expose: wrote ${OUT} (${#SVC_ORDER[@]} service(s))"
