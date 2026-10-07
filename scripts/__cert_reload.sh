#!/usr/bin/env bash
# scripts/__cert_reload.sh — reload whichever nginx serves TLS.
#
# WHY a script rather than `systemctl reload nginx` in the cert-renew unit: nginx
# runs in a container in this stack (cms-nginx-contest for the standalone front,
# grader-nginx-proxy for the domain stack), so the shipped unit's earlier
# `systemctl reload nginx-portal` named a unit that does not exist and the reload
# silently did nothing. This reloads whatever is actually running.
set -eu

CONTAINERS=("cms-nginx-contest" "grader-nginx-proxy" "cms-nginx-contest")

for name in "${CONTAINERS[@]}"; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
    if docker exec "$name" nginx -s reload 2>/dev/null; then
      echo "cert-reload: reloaded nginx in $name"
      exit 0
    fi
    echo "cert-reload: nginx reload failed in $name" >&2
  fi
done

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
  systemctl reload nginx && { echo "cert-reload: reloaded host nginx"; exit 0; }
fi

echo "cert-reload: no running nginx found to reload" >&2
exit 1
