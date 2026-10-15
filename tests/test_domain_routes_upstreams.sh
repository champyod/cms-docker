#!/usr/bin/env bash
# tests/test_domain_routes_upstreams.sh — pin the re-resolving route render.
#
# The route targets must be variables dialled through a resolver, not static upstream
# blocks: a static block resolves a container once at load and goes stale when that
# container is recreated — the 502 the reload used to paper over.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ROUTES="${REPO_ROOT}/scripts/__domain_routes.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

render() {
  DOMAIN_NAME="grader.example.org" \
  ADMIN_DOMAIN="admin.example.org" \
  CONTEST_LISTEN_PORT="8888" \
  ADMIN_NEXT_LISTEN_PORT="3000" \
  ADMIN_LISTEN_PORT="8889" \
  RANKING_LISTEN_PORT="8890" \
  OJ_BACKEND_PORT="8899" \
  PRIMARY_CLASSIC_ROUTE_PATH="${1:-}" \
  bash -c '
    set -uo pipefail
    log_die() { printf "DIE: %s\n" "$*" >&2; exit 1; }
    source "$1"
    _domain_routes_build
    _routes_front_vhost_map | sed "s/^/MAP|/"
    printf "RESOLVER|%s\n" "$ROUTE_RESOLVER"
    printf "SET|%s\n" "$PRIMARY_UPSTREAM_SET"
    printf "PRIMARY|%s\n" "$PRIMARY_ROUTE_BLOCKS"
    printf "ADMIN|%s\n" "$ADMIN_ROUTE_BLOCKS"
  ' _ "$ROUTES" 2>&1
}

OUT="$(render)"
has() { if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then ok "$1"; else no "$1 (missing: $2)"; fi; }
hasnt() { if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then no "$1 (present: $2)"; else ok "$1"; fi; }

printf '\n== the front door re-resolves instead of caching upstream addresses ==\n'
has "a resolver is emitted" "resolver 127.0.0.11 valid=10s ipv6=off;"
hasnt "no static upstream block survives" "upstream cms_"
has "the primary target is a variable" 'set $cms_primary cms-contest-web-server:8888;'
has "the primary location dials the variable" 'proxy_pass http://$cms_primary;'
has "a sub-path route rewrites its prefix away" 'rewrite ^/admin/(.*)$ /$1 break;'
has "the admin route dials its own variable" 'proxy_pass http://$cms_admin;'
# A route reaches the primary only by naming a path there: one key for both vhosts could not
# express "admin vhost only", and the classic admin answers on the admin vhost by default.
primary_blocks() { printf '%s\n' "$1" | sed -n '/^PRIMARY|/,/^ADMIN|/p'; }
if printf '%s\n' "$(primary_blocks "$OUT")" | grep -Fq -- 'location /classic/'; then
  no "the classic admin reaches the primary unasked"
else
  ok "the classic admin does not reach the primary unasked"
fi
PRIMARY_CLASSIC="$(render /classic)"
if printf '%s\n' "$(primary_blocks "$PRIMARY_CLASSIC")" | grep -Fq -- 'location /classic/'; then
  ok "the classic admin reaches the primary when the operator asks"
else
  no "PRIMARY_CLASSIC_ROUTE_PATH did not mount the classic on the primary"
fi
if printf '%s\n' "$OUT" | sed -n '/^ADMIN|/,/^$/p' | grep -Fq -- 'location /classic/'; then
  ok "the classic admin still answers on the admin vhost"
else
  no "the admin vhost lost its classic route"
fi

printf '\n== the front vhost map names the fragment each vhost includes ==\n'
# The map is what the config sync publishes for the registry: a `label|hostname|paths` line per
# vhost root, so an exposure under that name is rendered into the fragment its own include pulls in
# — and refused when its path is one that vhost's own block already answers on.
has "the primary vhost is mapped to its label and the paths it serves, its own fixed locations with them" "MAP|primary|grader.example.org|/ /admin /ranking /login /ws"
has "the admin vhost is mapped to its label and the paths it serves" "MAP|admin|admin.example.org|/ /classic"
hasnt "a second row on the admin vhost is no vhost of its own" "MAP|admin_classic"
hasnt "a vhost with no domain is not mapped" "MAP|oj|"
# The primary's fixed locations travel with it, so a fragment cannot claim the login or the
# WebSocket upgrade the vhost's own block serves; they belong to that block alone.
hasnt "a vhost without them is not handed the primary's fixed locations" "MAP|admin|admin.example.org|/ /classic /login"
if printf '%s\n' "$PRIMARY_CLASSIC" | grep -Fq -- 'MAP|primary|grader.example.org|/ /admin /ranking /classic /login /ws'; then
  ok "the map follows PRIMARY_CLASSIC_ROUTE_PATH onto the primary vhost"
else
  no "the map did not follow PRIMARY_CLASSIC_ROUTE_PATH onto the primary vhost"
fi
has "the primary vhost includes its fragment by its exact name" "include /etc/nginx/generated/locations-primary.conf;"
has "the admin vhost includes its fragment by its exact name" "include /etc/nginx/generated/locations-admin.conf;"
hasnt "no fragment include keeps a wildcard" "locations-primary*.conf"

printf '\n== the panel streams are kept alive on both panel vhosts ==\n'
# WHY the admin vhost and the primary sub-path separately: the panel answers at the root of
# its own vhost and under /admin on the primary, so the two SSE locations carry different
# prefixes and a single one would leave the other vhost cutting the stream at 90s.
has "the admin vhost carries the SSE location" 'location ~ ^/api/((notifications|resources|containers)/stream$|deploy/status/) {'
has "the primary vhost carries the SSE location under its prefix" 'location ~ ^/admin/api/((notifications|resources|containers)/stream$|deploy/status/) {'
has "the SSE location lengthens the read timeout" 'proxy_read_timeout 3600s;'
has "the SSE location buffers nothing" 'proxy_buffering off;'
sse_locations="$(printf '%s\n' "$OUT" | grep -c 'stream\$|deploy/status/' || true)"
if [[ "$sse_locations" -eq 2 ]]; then ok "both panel vhosts get the SSE location"; else no "both panel vhosts get the SSE location (found ${sse_locations})"; fi
if grep -qF 'SSE_ENDPOINT_PATTERN' "${REPO_ROOT}/scripts/__nginx_sse.sh"; then ok "the SSE pattern has one shared definition"; else no "the SSE pattern has one shared definition"; fi
if grep -qF '${SSE_ENDPOINT_PATTERN}' "${REPO_ROOT}/scripts/__domain.sh"; then ok "the domain renderer lets the shared SSE names through envsubst"; else no "the domain renderer lets the shared SSE names through envsubst"; fi

printf '\n== the front door emits one resolver and a loadable config ==\n'
# P15: the redis block used to emit a resolver the route table also emits, and the
# stapling block pointed at a chain.pem issuance may not write. Either alone makes
# nginx reject the file it loads (default.conf in grader-nginx-proxy).
if grep -qE '^resolver ' "${REPO_ROOT}/scripts/__domain.sh"; then
  no "the redis block emits no active resolver"
else
  ok "the redis block emits no active resolver"
fi
resolver_lines="$(printf '%s\n' "$OUT" | grep -c 'resolver 127.0.0.11' || true)"
if [[ "$resolver_lines" -eq 1 ]]; then ok "the route table emits exactly one resolver"; else no "the route table emits exactly one resolver (found ${resolver_lines})"; fi
if grep -rqE '(^|[^l])chain\.pem' "${REPO_ROOT}/config/grader.nginx.conf.template" "${REPO_ROOT}/scripts/__security_headers.sh"; then
  no "nothing points at a chain file issuance may not write"
else
  ok "nothing points at a chain file issuance may not write"
fi
if grep -qE 'listen .*ssl http2;' "${REPO_ROOT}/config/grader.nginx.conf.template"; then
  no "the listen line uses the modern http2 form"
else
  ok "the listen line uses the modern http2 form"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
