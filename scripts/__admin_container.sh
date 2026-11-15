#!/usr/bin/env bash
# Which admin-panel container is the migration path allowed to exec into?
#
# WHY: the path hardcoded `cms-admin-panel-next` (colour A). Blue-green runs with colour B serving
# and colour A stopped, so before a swap the container was always down — and the host fallback it
# then used could not reach the database either. Asking this script makes the answer follow the
# deployment instead of assuming one colour.
#
# Order: an explicit CMS_ADMIN_CONTAINER wins, then whichever colour is actually running, then the
# default name (so callers still produce a sensible message when nothing is up).
set -euo pipefail

if [[ -n "${CMS_ADMIN_CONTAINER:-}" ]]; then
  printf '%s\n' "$CMS_ADMIN_CONTAINER"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  running="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  for candidate in cms-admin-panel-next cms-admin-panel-next-b; do
    if grep -qx "$candidate" <<<"$running"; then
      printf '%s\n' "$candidate"
      exit 0
    fi
  done
fi

printf 'cms-admin-panel-next\n'
