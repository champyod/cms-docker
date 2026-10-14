#!/usr/bin/env bash
# scripts/__domain_proxy_reload.sh — re-render the front config and re-resolve
# grader-nginx-proxy's upstreams after a deploy; always exits 0.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="grader-nginx-proxy"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  exit 0
fi

# WHY the render and not only the reload: a deploy is also where a template change reaches
# the front. Reloading alone serves the config rendered last time, so an include the
# template gained after that render — such as the generated routes — never lands. The
# domain tool owns that transform, and reloads the proxy itself once it succeeds; a box
# whose domain is not configured keeps the bare reload.
if bash "${SCRIPT_DIR}/__domain.sh" proxy --apply >/dev/null 2>&1; then
  exit 0
fi
echo "[WARN] domain-proxy-reload: could not re-render the front config — reloading the one already in place" >&2

if ! docker exec "$CONTAINER" nginx -s reload >/dev/null 2>&1; then
  echo "[WARN] domain-proxy-reload: nginx reload failed in $CONTAINER" >&2
fi

exit 0
