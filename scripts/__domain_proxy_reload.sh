#!/usr/bin/env bash
# scripts/__domain_proxy_reload.sh — re-render the front config and re-resolve
# grader-nginx-proxy's upstreams after a deploy; always exits 0 unless --strict.
#
# --strict is for a caller that cannot tolerate a stale front: it fails instead of falling
# back to reloading the config already in place, and it returns the reload's own exit code.
# The admin-panel swap uses it, because it stops the retired colour on the strength of this
# step having succeeded.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="grader-nginx-proxy"
STRICT=0

case "${1:-}" in
  --strict) STRICT=1 ;;
  "") ;;
  *) echo "[FAIL] unknown argument: $1" >&2; exit 2 ;;
esac

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  # A deploy on a box without the domain stack has nothing to reload. A swap, however, only
  # makes sense with a front to re-point, so strict treats it as a failure.
  if [[ "$STRICT" == "1" ]]; then
    echo "[FAIL] $CONTAINER is not running — there is no front to re-render" >&2
    exit 1
  fi
  exit 0
fi

# WHY the render and not only the reload: a deploy is also where a template change reaches
# the front. Reloading alone serves the config rendered last time, so an include the
# template gained after that render — such as the generated routes — never lands. The
# domain tool owns that transform, and reloads the proxy itself once it succeeds; a box
# whose domain is not configured keeps the bare reload.
if bash "${SCRIPT_DIR}/__domain.sh" proxy --apply >/dev/null 2>&1; then
  if [[ "$STRICT" != "1" ]]; then
    exit 0
  fi
  # The apply reloads, but its own reload failure is a warning. Strict asks a second time so
  # the caller gets an exit code it can act on.
  if ! docker exec "$CONTAINER" nginx -s reload >/dev/null 2>&1; then
    echo "[FAIL] nginx reload failed in $CONTAINER" >&2
    exit 1
  fi
  exit 0
fi

if [[ "$STRICT" == "1" ]]; then
  # No fallback reload: the rendered config was rejected, so reloading the one in place would
  # make the caller believe the flip landed.
  echo "[FAIL] domain-proxy-reload: the front config was not re-rendered" >&2
  exit 1
fi
echo "[WARN] domain-proxy-reload: could not re-render the front config — reloading the one already in place" >&2

if ! docker exec "$CONTAINER" nginx -s reload >/dev/null 2>&1; then
  echo "[WARN] domain-proxy-reload: nginx reload failed in $CONTAINER" >&2
fi

exit 0
