#!/usr/bin/env bash
# scripts/__domain_proxy_reload.sh — re-resolve grader-nginx-proxy's upstreams after a deploy; always exits 0.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

CONTAINER="grader-nginx-proxy"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  exit 0
fi

if ! docker exec "$CONTAINER" nginx -s reload >/dev/null 2>&1; then
  echo "[WARN] domain-proxy-reload: nginx reload failed in $CONTAINER" >&2
fi

exit 0
