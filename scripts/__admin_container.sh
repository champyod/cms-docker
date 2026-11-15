#!/usr/bin/env bash
# Which admin-panel container may the migration path exec into: CMS_ADMIN_CONTAINER, else the
# running colour, else colour A — blue-green stops A before a swap, so assuming A was always wrong.
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
