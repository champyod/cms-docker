#!/usr/bin/env bash
# scripts/__contest_set_active.sh — set the deployment's default contest in the database.
#
# WHY the database and not config.toml: contests.is_active is the deployment's default contest,
# and a service registry row names the contest one instance serves and outranks it
# (cms.db.contest_binding reads that row per call). Nothing derives config.toml [contest]
# CONTEST_ID from either, so writing the file here would be a second writable copy of a value no
# process reads it for. The `cms` shim and the Rust CLI both route `contest set-active` to this
# script, so the mutation lives in one place — and since a service reads the default per call,
# the write reaches a running one within a few seconds: nothing is regenerated or restarted.
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

  Sets contests.is_active: the contest a service the registry does not bind serves. Refuses
  while a ContestWebServer row names a contest, because that row decides what is served. The
  change reaches a running service within a few seconds; nothing is restarted.
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

# Refuse while a row decides: an enabled ContestWebServer row that names a contest outranks the
# flag, so writing it would report a change nothing serves. The rows are named because editing
# them is what the operator has to do; a deployment with no registry table has none to name.
require_unshadowed_default() {
  local present bound
  present="$(db_exec "SELECT to_regclass('public.services') IS NOT NULL;")"
  [[ "$present" == "t" ]] || return 0
  bound="$(db_exec "SELECT string_agg(name || ' -> contest ' || contest_id, ', ' ORDER BY shard, id)
    FROM services WHERE role = 'ContestWebServer' AND enabled AND contest_id IS NOT NULL;")"
  [[ -z "$bound" ]] \
    || log_die "these registry rows decide what is served, so contests.is_active would change nothing: ${bound}. Edit them in the panel's service registry (Infrastructure, Services) or clear their binding." 1
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
  log_info "active contest set to ${id} in '$POSTGRES_DB_VAL' (contests.is_active); a service the registry does not bind picks it up within a few seconds"
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
  require_unshadowed_default
  set_active_contest "$id"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
