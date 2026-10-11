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
  bash -c '
    set -uo pipefail
    log_die() { printf "DIE: %s\n" "$*" >&2; exit 1; }
    source "$1"
    _domain_routes_build
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

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
