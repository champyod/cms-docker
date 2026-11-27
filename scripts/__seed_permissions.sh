#!/usr/bin/env bash
# Seed permissions from the admin image when the host has no panel dependencies.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

DATABASE_URL_VALUE="${1:-}"
[[ -n "$DATABASE_URL_VALUE" ]] || log_die "seed-permissions: owner database URL required" 1

image="${ADMIN_IMAGE:-}"
if [[ -z "$image" ]]; then
  image="$(docker inspect -f '{{.Config.Image}}' cms-admin-panel-next 2>/dev/null || true)"
fi
if [[ -z "$image" ]]; then
  image="$(docker image ls --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^ghcr\.io/champyod/cms-docker-admin-panel:' | head -n 1 || true)"
fi
[[ -n "$image" ]] || log_die "seed-permissions: no admin panel image found" 1

exec docker run --rm --network host \
  -e "DATABASE_URL=$DATABASE_URL_VALUE" \
  "$image" /bin/sh -lc 'cd /app && node_modules/.bin/tsx prisma/seed-permissions.ts'
