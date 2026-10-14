#!/usr/bin/env bash
# scripts/__contest_set_active.sh — set the active contest in the database.
#
# WHY the database and not config.toml: contests.is_active is the deployment's default contest,
# and a service registry row names the contest one instance serves and outranks it
# (cms.db.contest_binding reads that row per call). Nothing derives config.toml [contest]
# CONTEST_ID from either, so writing the file here would be a second writable copy of a value no
# process reads it for. The `cms` shim and the Rust CLI both route `contest set-active` to this
# script, so the mutation lives in one place.
#
# Usage:
#   __contest_set_active.sh <id>
#
# Exit codes: 0 = set (or already active), 1 = refused or failed.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

DB_CONTAINER="cms-database"
ENV_FILE=".env"

usage() {
  cat <<'USAGE'
Usage:
  __contest_set_active.sh <id>

  Sets contests.is_active in the database to <id>, regenerates config.toml and .env
  from it, and restarts the contest stack so it serves that contest.
USAGE
}

# One env value read verbatim. WHY env_unquote: __config_sync quotes a value that holds
# whitespace or a shell metacharacter, so a password with a space would otherwise reach
# psql with its quotes still attached.
read_env_value() {
  local key="$1" raw
  raw="$(awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$ENV_FILE" 2>/dev/null | tr -d '\r' || true)"
  env_unquote "$raw"
}

# Run one SQL statement in the running database and print its single value. Fail-loud on
# any psql error so a query that cannot run is never mistaken for an empty result.
db_exec() {
  local sql="$1" db_user db_pass db_name
  db_user="${POSTGRES_USER_VAL:-cmsuser}"
  db_pass="${POSTGRES_PASSWORD_VAL:-}"
  db_name="${POSTGRES_DB_VAL:-cmsdb}"
  docker exec -i -e PGPASSWORD="$db_pass" "$DB_CONTAINER" \
    psql -U "$db_user" -d "$db_name" -tA -v ON_ERROR_STOP=1 -c "$sql"
}

# Credentials and a running database are prerequisites: the whole point of this command is
# to write the database, so a missing .env or a stopped container is refused, not guessed.
require_database() {
  [[ -f "$ENV_FILE" ]] || log_die "$ENV_FILE not found — run './cms config sync' first." 1
  POSTGRES_USER_VAL="$(read_env_value POSTGRES_USER)"; POSTGRES_USER_VAL="${POSTGRES_USER_VAL:-cmsuser}"
  POSTGRES_PASSWORD_VAL="$(read_env_value POSTGRES_PASSWORD)"
  POSTGRES_DB_VAL="$(read_env_value POSTGRES_DB)"; POSTGRES_DB_VAL="${POSTGRES_DB_VAL:-cmsdb}"
  [[ -n "$POSTGRES_PASSWORD_VAL" ]] || log_die "POSTGRES_PASSWORD is empty or missing in $ENV_FILE" 1
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER" \
    || log_die "database container '$DB_CONTAINER' is not running — start it with 'make core' first." 1
  local has_table
  has_table="$(db_exec "SELECT to_regclass('public.contests') IS NOT NULL;")"
  [[ "$has_table" == "t" ]] \
    || log_die "the '$POSTGRES_DB_VAL' database has no contests table yet — initialise it and import a contest first." 1
}

# Refuse an id that no contest carries: writing it would flag nothing active and leave the
# stack with no contest to serve.
require_existing_contest() {
  local id="$1" exists
  exists="$(db_exec "SELECT count(*) FROM contests WHERE id = ${id};")"
  [[ "$exists" == "1" ]] || log_die "no contest with id ${id} in '$POSTGRES_DB_VAL' — nothing to activate." 1
}

# Move is_active onto <id> in one statement, so exactly one row stays active.
set_active_contest() {
  local id="$1" before
  before="$(db_exec "SELECT id FROM contests WHERE is_active ORDER BY id LIMIT 1;")"
  if [[ "$before" == "$id" ]]; then
    log_info "contest ${id} is already active in the database — no change needed"
    return 0
  fi
  db_exec "UPDATE contests SET is_active = (id = ${id});" >/dev/null
  log_info "active contest set to ${id} in '$POSTGRES_DB_VAL' (contests.is_active)"
}

# WHY restart: the Python services resolve the active contest once at start, so a running
# stack keeps serving the previous one until it is recreated. compose's `up -d` recreates
# only the services whose config changed, which is exactly the contest profile.
restart_contest_stack() {
  local deploy_type
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^cms-(contest-web-server|evaluation-service|proxy-service)$'; then
    log_info "contest stack is not running — nothing to restart; 'make contest' will serve the active contest"
    return 0
  fi
  deploy_type="$(read_env_value DEPLOYMENT_TYPE)"
  log_info "restarting the contest stack to serve the active contest..."
  if [[ "$deploy_type" == "img" ]]; then
    make -e DEPLOYMENT_TYPE_OVERRIDE=img contest
  else
    make contest
  fi
}

main() {
  local id="${1:-}"
  if [[ -z "$id" ]]; then
    usage >&2
    exit 1
  fi
  if [[ ! "$id" =~ ^[0-9]+$ ]]; then
    log_die "invalid contest id '${id}' (expected a positive integer)." 1
  fi

  require_database
  require_existing_contest "$id"
  set_active_contest "$id"

  if ! bash scripts/__config_sync.sh; then
    log_die "contests.is_active now names ${id}, but './cms config sync' failed — config.toml/.env may still describe the previous contest. Fix the error above, then run './cms config sync'." 1
  fi

  restart_contest_stack
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
