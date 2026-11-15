#!/usr/bin/env bash
# Owner-role database URL for <container|host>.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
[ -f "${REPO_ROOT}/.env" ] && { set -a; . "${REPO_ROOT}/.env"; set +a; }

mode="${1:-}"
user="${POSTGRES_USER:-cmsuser}"
pass="${POSTGRES_PASSWORD:-}"
db="${POSTGRES_DB:-cmsdb}"

case "$mode" in
  container)
    printf 'postgresql://%s:%s@database:5432/%s\n' "$user" "$pass" "$db"
    ;;
  host)
    host="${DB_BIND_IP:-127.0.0.1}"
    port="${POSTGRES_PORT_EXTERNAL:-5432}"
    printf 'postgresql://%s:%s@%s:%s/%s\n' "$user" "$pass" "$host" "$port" "$db"
    ;;
  *)
    echo "usage: $(basename "$0") <container|host>" >&2
    exit 2
    ;;
esac
