#!/usr/bin/env bash
# The owner-role database URL the migration path must use, per side of the container boundary.
#
# WHY a script: the Makefile had these URLs inline, and the host one was hardcoded to
# `localhost:5432`. That is not where the database listens on a deployed host — compose publishes
# it on ${DB_BIND_IP} (here the tailnet interface), so `make prisma-sync` could never connect from
# the host, and the failure only showed up when the container side was unavailable.
#
# Usage: __owner_url.sh <container|host>
# Reads POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB, plus DB_BIND_IP / POSTGRES_PORT_EXTERNAL
# for the host side. Prints one URL. Never prints a password to stderr or a log line.
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
    # The compose service name, resolved on the project network: stable regardless of colour.
    printf 'postgresql://%s:%s@database:5432/%s\n' "$user" "$pass" "$db"
    ;;
  host)
    # The published interface, not localhost: compose binds ${DB_BIND_IP}, which on a deployed
    # host is the tailnet address and is not the same thing as 127.0.0.1.
    host="${DB_BIND_IP:-127.0.0.1}"
    port="${POSTGRES_PORT_EXTERNAL:-5432}"
    printf 'postgresql://%s:%s@%s:%s/%s\n' "$user" "$pass" "$host" "$port" "$db"
    ;;
  *)
    echo "usage: $(basename "$0") <container|host>" >&2
    exit 2
    ;;
esac
