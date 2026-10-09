#!/usr/bin/env bash
# scripts/__db_admin.sh — create/rename a PostgreSQL database inside the running
# `cms-database` container.
#
# WHY this exists: `./cms` had no CREATE DATABASE path and no rename path at
# all, so provisioning a sibling database (cmsdb -> cmsdb_evaluate) meant
# hand-written SQL against a container nobody documented. Both operations
# MUTATE the server, so they follow the same confirmation philosophy as
# scripts/__db_destroy_guard.sh: an explicit non-interactive authorisation
# (CONFIRM_DB_ADMIN=yes) or the literal word `yes` typed at a terminal.
# Nothing here deletes a database — no create can overwrite, and rename only
# moves a name — so the gate is deliberately lighter than the destroy guard.
#
# Not a database drop tool: Postgres has no `DROP DATABASE IF EXISTS` and a
# drop cannot be undone, so `drop` is intentionally absent. Use psql directly
# if you really mean it.
#
# Credentials come from the existing environment/.env conventions (POSTGRES_*
# exported by `make env` / scripts/__config_sync.sh, the same keys
# scripts/__restore.sh reads); when they are absent this script falls back to
# the values the container was created with, read from the container itself.
# No credential literal lives in this file.
#
# Usage:
#   __db_admin.sh create <name> [--dry-run]
#   __db_admin.sh rename <old> <new> [--dry-run]
#
# Authorise non-interactively with:
#   CONFIRM_DB_ADMIN=yes scripts/__db_admin.sh create cmsdb_evaluate
#
# Exit codes: 0 = done (or dry-run printed), 1 = refused/failed.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# Shared helpers: log_info/log_warn/log_die, env_unquote (used to read the
# quoted values scripts/__config_sync.sh writes into .env).
if [[ ! -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  printf '[FAIL] %s\n' "missing ${SCRIPT_DIR}/__lib/common.sh — deliver scripts/__lib beside this script" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

DB_CONTAINER="${CMS_DB_CONTAINER:-cms-database}"

# Postgres identifiers: unquoted, lower-case, no leading digit, <= 63 bytes.
# WHY this is stricter than the server: every value here is interpolated into
# SQL and into a database URI, so the allowlist is the injection boundary and
# it must not lean on server-side folding to catch a bad name.
readonly DB_IDENT_RE='^[a-z_][a-z0-9_]{0,50}$'
# Not a database: renaming onto either name would break the cluster itself.
readonly DB_RESERVED_REGEX='^(template0|template1|postgres|all)$'
# config.toml groups every database credential set under a [db_<profile>]
# section; scripts/__config_sync.sh reads the same prefix.
readonly DB_PROFILE_PREFIX='db_'

usage() {
  cat <<'USAGE'
Usage:
  __db_admin.sh create <name> [--dry-run]
  __db_admin.sh rename <old> <new> [--dry-run]

  create  CREATE DATABASE <name> if it does not already exist (idempotent).
  rename  ALTER DATABASE <old> RENAME TO <new> (no overwrite, no drop).

  --dry-run          print the exact SQL and exit 0 without touching docker.
  CONFIRM_DB_ADMIN=yes  authorise non-interactively (scripts/CI). On a
                        terminal you are otherwise asked to type "yes".

Notes:
  rename takes <old> out of service on its own: it blocks new connections,
  drops the sessions the running services hold, renames, then re-opens the new
  name — no service is stopped. renaming does NOT update .env or config.toml —
  repoint the db_<profile> POSTGRES_DB yourself, then run: ./cms config sync
USAGE
}

require_ident() {
  local name="$1" label="$2"
  if [[ ! "$name" =~ $DB_IDENT_RE ]]; then
    log_die "invalid ${label} '${name}' — database identifiers must match ${DB_IDENT_RE} (lower-case letters, digits, '_'; cannot start with a digit; max 51 chars)."
  fi
  if [[ "$name" =~ $DB_RESERVED_REGEX ]]; then
    log_die "'${name}' is not a database — 'template0', 'template1', 'postgres' and 'all' are not valid targets for ${label}."
  fi
}

# Credentials: an already-exported POSTGRES_* wins; otherwise take them from
# the generated .env (same precedence scripts/__restore.sh uses). Values are
# unquoted with the shared helper so a quoted .env value reads back verbatim.
load_db_env() {
  local file key raw
  for file in "${REPO_ROOT}/.env" "${REPO_ROOT}/.env.core"; do
    [[ -f "$file" ]] || continue
    for key in POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD; do
      [[ -n "$(eval "printf '%s' \"\${${key}:-}\"")" ]] && continue
      raw="$(awk -F= -v k="$key" '$1==k {v=$0; sub(/^[^=]*=/,"",v); print v; exit}' "$file" 2>/dev/null || true)"
      [[ -z "$raw" ]] && continue
      export "$key"="$(env_unquote "$raw")"
    done
  done
}

# Last resort: the credentials the container was actually created with. `docker
# inspect` on the container itself, so still no literal in this file.
load_container_env() {
  local v
  for key in POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD; do
    [[ -n "$(eval "printf '%s' \"\${${key}:-}\"")" ]] && continue
    v="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER" 2>/dev/null \
      | awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print; exit}' || true)"
    [[ -z "$v" ]] && continue
    export "$key"="$v"
  done
}

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || log_die "docker CLI not found — run this on the host that runs the cms-database container."
  docker inspect "$DB_CONTAINER" >/dev/null 2>&1 \
    || log_die "container '${DB_CONTAINER}' is not available — start the core stack first: make core"
  local state
  state="$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || echo false)"
  [[ "$state" == "true" ]] \
    || log_die "container '${DB_CONTAINER}' exists but is not running — start it first: make core"
}

# psql inside the container. PGPASSWORD travels through `docker exec -e`, never
# on the host argv. -v ON_ERROR_STOP=1 makes SQL failures exit non-zero instead
# of being swallowed by psql's default continue-on-error.
psql_exec() {
  local db="$1" sql="$2"
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB_CONTAINER" \
    psql -U "${POSTGRES_USER:-cmsuser}" -d "$db" -v ON_ERROR_STOP=1 -c "$sql"
}

# Existence probe against the maintenance database. -tAc yields a bare 1/0.
db_exists() {
  local name="$1" out
  out="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB_CONTAINER" \
    psql -U "${POSTGRES_USER:-cmsuser}" -d "postgres" -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${name}'" 2>/dev/null || true)"
  [[ "$(printf '%s' "$out" | tr -d '[:space:]')" == "1" ]]
}

# Report the sessions blocking a rename. ALTER DATABASE ... RENAME fails while
# any other session (including the pre-migration services' pools) is attached, so
# naming the blockers turns "transaction is not allowed" into an action list.
# Never fatal: the ALTER below is the authority, this only explains it.
list_blocking_sessions() {
  local old="$1" out rc=0
  out="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB_CONTAINER" \
    psql -U "${POSTGRES_USER:-cmsuser}" -d "postgres" -tAc \
    "SELECT datname || ' | ' || usename || ' | ' || application_name || ' | ' || pid \
       FROM pg_stat_activity WHERE datname = '${old}' AND pid <> pg_backend_pid()" 2>/dev/null)" || rc=$?
  if [[ $rc -ne 0 ]]; then
    log_warn "could not enumerate sessions connected to '${old}' (psql exited ${rc})."
  elif [[ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]]; then
    log_warn "no connected sessions visible for '${old}', but the rename still reports an open connection."
  else
    log_warn "sessions connected to '${old}' (datname | user | application | pid):"
    printf '%s\n' "$out" | sed 's/^/    /' >&2
  fi
}

# Same philosophy as scripts/__db_destroy_guard.sh: explicit authorisation is
# the only path available to a non-interactive caller, and an interactive caller
# must type the literal word. A stray newline is not consent.
confirm_admin() {
  local action="$1" detail="$2"
  if [[ "${CONFIRM_DB_ADMIN:-no}" == "yes" ]]; then
    log_info "CONFIRM_DB_ADMIN=yes — proceeding with: ${detail}"
    return 0
  fi
  if [[ ! -t 0 ]]; then
    {
      echo "REFUSED: '${action}' mutates the database and there is no terminal to confirm on."
      echo ""
      echo "To authorise it deliberately, re-run with:"
      echo "    CONFIRM_DB_ADMIN=yes $0 ${action}"
    } >&2
    exit 1
  fi
  printf 'Type "yes" to run: %s : ' "$detail"
  local answer
  read -r answer || answer=""
  if [[ "$answer" == "yes" ]]; then
    log_info "Confirmed — proceeding."
    return 0
  fi
  echo "Aborted. The database was not modified." >&2
  echo "To authorise non-interactively: CONFIRM_DB_ADMIN=yes $0 ${action}" >&2
  exit 1
}

cmd_create() {
  local name="$1" dry_run="$2" sql
  require_ident "$name" "database name"
  # CREATE DATABASE cannot run inside a transaction block, and `-c` sends one
  # statement: exactly one CREATE DATABASE per successful probe.
  sql="CREATE DATABASE \"${name}\";"

  if [[ "$dry_run" == "1" ]]; then
    echo "SELECT 1 FROM pg_database WHERE datname = '${name}';   # skip when it returns 1"
    echo "$sql"
    log_info "Dry run — no database was created."
    return 0
  fi

  require_docker
  load_db_env
  load_container_env

  if db_exists "$name"; then
    log_info "database \"${name}\" already exists — nothing to create."
    return 0
  fi

  confirm_admin "create" "create database \"${name}\" in ${DB_CONTAINER}"
  psql_exec "postgres" "$sql"
  log_info "created \"${name}\" in ${DB_CONTAINER}."
  log_info "next: point the owning db_<profile> POSTGRES_DB at \"${name}\", then run: ./cms config sync"
}

# The right-hand side of a `key = ...`, but only when it is one plain quoted
# string. Fails on a bare word, an array, an inline table or a multi-line string
# instead of guessing: the one mistake this reader must not make is reporting a
# stale profile as clean.
toml_plain_string() {
  local raw="$1" quote rest value tail
  raw="${raw#"${raw%%[![:space:]]*}"}"       # ltrim
  [[ "$raw" == '"'* || "$raw" == "'"* ]] || return 1
  quote="${raw:0:1}"
  rest="${raw:1}"
  [[ "$rest" == *"${quote}"* ]] || return 1
  value="${rest%%"${quote}"*}"                # up to the first closing quote
  tail="${rest#"$value"}"                     # exact-string removal, not a glob
  tail="${tail:1}"                            # the closing quote itself
  tail="${tail#"${tail%%[![:space:]]*}"}"   # ltrim
  [[ -z "$tail" || "$tail" == '#'* ]] || return 1
  printf '%s\n' "$value"
}

# The profiles whose [db_<profile>] POSTGRES_DB still names <target>, one per
# line in file order. Exit 2 when config.toml is absent or unreadable, because
# "cannot determine" and "nothing points there" are different answers.
#
# WHY a hand-rolled reader: scripts/__config_sync.sh's parse_toml is a
# script-local function rather than a shared library, and this needs one key out
# of one section shape, not a whole parse.
db_profiles_pointing_at() {
  local target="$1"
  local file="${REPO_ROOT}/config.toml"
  local section="" line trimmed rest

  [[ -r "$file" ]] || return 2

  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line%%$'\r'}"
    trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"   # ltrim
    [[ -z "$trimmed" || "$trimmed" == '#'* ]] && continue

    # The exact `[name]` form __config_sync.sh writes. A header carrying a
    # trailing comment is not recognised, which drops the section rather than
    # misreading its keys.
    if [[ "$trimmed" == "["*"]" ]]; then
      section="${trimmed:1:${#trimmed}-2}"
      continue
    fi

    [[ "$section" == "${DB_PROFILE_PREFIX}"* ]] || continue
    [[ "$trimmed" == POSTGRES_DB* ]] || continue
    rest="${trimmed#POSTGRES_DB}"
    rest="${rest#"${rest%%[![:space:]]*}"}"            # ltrim
    [[ "$rest" == "="* ]] || continue

    # In the condition, not an assignment: a value that is not a plain quoted
    # string makes this substitution fail, and an assignment would abort the
    # script under set -e.
    if [[ "$(toml_plain_string "${rest#=}")" == "$target" ]]; then
      printf '%s\n' "${section:${#DB_PROFILE_PREFIX}}"
    fi
  done < "$file"
}

# How many db_<profile> entries still name <old>, and which ones. WHY the count:
# POSTGRES_DB is per-profile, so an N-profile deployment needs N repoints, and
# until they are made every service is configured with a database name that no
# longer exists and fails at connect time with a generic error. Never fatal: the
# rename has already happened by the time this runs.
report_profiles_pointing_at() {
  local old="$1" new="$2" profiles profile count
  local -a names=()

  if ! profiles="$(db_profiles_pointing_at "$old")"; then
    log_warn "config.toml is missing or unreadable — cannot say which db_<profile> entries still point at \"${old}\"."
    log_info "grep -n 'POSTGRES_DB' config.toml to find them, point them at \"${new}\", then run: ./cms config sync"
    return 0
  fi

  while IFS= read -r profile; do
    [[ -n "$profile" ]] && names+=("$profile")
  done <<<"${profiles}"
  count=${#names[@]}

  if [[ "$count" -eq 0 ]]; then
    log_info "no db_<profile> section in config.toml points at \"${old}\" — nothing to repoint there."
    return 0
  fi

  log_warn "db_<profile> sections in config.toml still pointing at \"${old}\" (${count} found):"
  printf '%s\n' "${names[@]}" | sed "s/^/    ${DB_PROFILE_PREFIX}/" >&2
  log_info "point them at \"${new}\" in config.toml, then run: ./cms config sync"
}

cmd_rename() {
  local old="$1" new="$2" dry_run="$3"
  require_ident "$old" "source database name"
  require_ident "$new" "target database name"
  if [[ "$old" == "$new" ]]; then
    log_die "source and target name are both '${old}' — nothing to rename."
  fi

  # Take <old> out of service, rename it, put it back. Blocking new connections
  # first is what makes the terminate hold: a pool reconnecting between the two
  # statements would block the rename again.
  local sql_disable="ALTER DATABASE \"${old}\" WITH ALLOW_CONNECTIONS false;"
  local sql_terminate="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${old}' AND pid <> pg_backend_pid();"
  local sql_rename="ALTER DATABASE \"${old}\" RENAME TO \"${new}\";"
  local sql_enable="ALTER DATABASE \"${new}\" WITH ALLOW_CONNECTIONS true;"
  local sql_reopen_old="ALTER DATABASE \"${old}\" WITH ALLOW_CONNECTIONS true;"

  if [[ "$dry_run" == "1" ]]; then
    echo "# Each statement is sent on its own: ALTER DATABASE cannot run in a transaction block."
    echo "# No service is stopped — the running pools are dropped and error until repointed."
    echo "$sql_disable"
    echo "$sql_terminate"
    echo "$sql_rename"
    echo "$sql_enable"
    log_info "Dry run — no database was renamed."
    return 0
  fi

  require_docker
  load_db_env
  load_container_env

  if ! db_exists "$old"; then
    log_die "source database \"${old}\" does not exist — nothing to rename (see ./cms db use)."
  fi
  if db_exists "$new"; then
    log_die "target database \"${new}\" already exists — refusing to rename onto it (no overwrite on Postgres)."
  fi

  confirm_admin "rename" "rename database \"${old}\" to \"${new}\" in ${DB_CONTAINER}"

  if ! psql_exec "postgres" "$sql_disable"; then
    log_die "could not take \"${old}\" out of service — the database was NOT renamed."
  fi

  # A failure past this point must re-open <old>, or it is left refusing connections.
  if ! psql_exec "postgres" "$sql_terminate"; then
    psql_exec "postgres" "$sql_reopen_old" >/dev/null 2>&1 || true
    log_die "could not drop the sessions on \"${old}\" — it accepts connections again; the database was NOT renamed."
  fi

  if ! psql_exec "postgres" "$sql_rename"; then
    psql_exec "postgres" "$sql_reopen_old" >/dev/null 2>&1 || true
    log_warn "the rename failed — PostgreSQL reports the blocking sessions below."
    list_blocking_sessions "$old"
    log_die "\"${old}\" accepts connections again; the database was NOT renamed."
  fi

  psql_exec "postgres" "$sql_enable" \
    || log_die "renamed to \"${new}\" but it still refuses connections — run: ${sql_enable}"

  log_info "renamed \"${old}\" to \"${new}\" in ${DB_CONTAINER}."
  report_profiles_pointing_at "$old" "$new"
}

main() {
  local action="${1:-}" dry_run=0
  shift || true

  local args=()
  local a
  for a in "$@"; do
    case "$a" in
      --dry-run) dry_run=1 ;;
      -h|--help) usage; exit 0 ;;
      *) args+=("$a") ;;
    esac
  done

  case "$action" in
    create)
      [[ ${#args[@]} -eq 1 ]] || { usage >&2; exit 1; }
      cmd_create "${args[0]}" "$dry_run"
      ;;
    rename)
      [[ ${#args[@]} -eq 2 ]] || { usage >&2; exit 1; }
      cmd_rename "${args[0]}" "${args[1]}" "$dry_run"
      ;;
    ""|-h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown action '${action}'." >&2
      usage >&2
      exit 1
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
