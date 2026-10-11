#!/usr/bin/env bash
# scripts/__db_migrate.sh — take the ACTIVE database to schema + roles + RLS ready.
#
# WHY this exists: `./cms db create` issues one statement and `./cms db rename`
# only moves a name, so both leave a database that no service can use until the
# migration history, the roles and row-level security have been applied. That
# gap used to be a remembered order (`make cms-init`, `make prisma-sync`). This
# script is that step: it runs the two idempotent make targets the no-arg `./cms`
# lifecycle already sequences, then verifies the result, so the order and the
# verdict live in one place instead of in an operator's memory.
#
# It is not a SQL tool. Every schema change stays in `make cms-init` and
# `make prisma-sync`; this script owns the preconditions, the order and the check.
#
# Scope, in full: it migrates the database `.env` describes — the active `[db_<profile>]`
# that `./cms db use <profile>` selects. It never writes config.toml, never creates
# or renames a database and never switches profiles. Reaching a different profile
# is `./cms db use <profile>` first, because these steps read .env.
#
# Usage:
#   __db_migrate.sh [--dry-run]
#
# Authorise non-interactively with:
#   CONFIRM_DB_MIGRATE=yes scripts/__db_migrate.sh
#
# Exit codes: 0 = migrated and verified (or dry run printed), 1 = refused or failed.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  printf '[FAIL] %s\n' "missing ${SCRIPT_DIR}/__lib/common.sh — deliver scripts/__lib beside this script" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

DB_CONTAINER="${CMS_DB_CONTAINER:-cms-database}"
LOG_CONTAINER="${CMS_LOG_CONTAINER:-cms-log-service}"

# The two targets `./cms`' own lifecycle runs, in that order. cms-init creates the
# core schema when it is absent; prisma-sync bootstraps the roles, resolves the
# P3005 baseline, deploys the migration history (which is where ENABLE+FORCE RLS
# lands) and seeds permissions.
readonly MAKE_CMS_INIT="cms-init"
readonly MAKE_PRISMA_SYNC="prisma-sync"

# `contests` is the same marker scripts/__cms-db-init.sh probes to decide whether
# the core schema already exists, so "migrated" here and "already built" there
# are one test rather than two that could disagree.
readonly SCHEMA_MARKER_TABLE="contests"
# Row-level security is forced on every application table; only Prisma's own
# migration ledger is exempt. docs/DB-ROTATION.md §7.6 names this as the check
# that separates a migrated database from an empty one.
readonly RLS_EXEMPT_TABLE="_prisma_migrations"
# The repository owns the migration history; the applied ledger must cover it.
readonly REPO_MIGRATIONS_DIR="admin-panel/prisma/migrations"
# Defaults copied from the generated .env; the file's own values win.
readonly DEFAULT_POSTGRES_USER="cmsuser"
readonly DEFAULT_POSTGRES_DB="cmsdb"
readonly DEFAULT_POSTGRES_PORT="5432"

usage() {
  cat <<'USAGE'
Usage:
  __db_migrate.sh [--dry-run]

  Applies the full migration history to the ACTIVE database: role bootstrap,
  base schema, prisma migrate deploy (RLS included) and the permission seed.

  --dry-run            print the steps and exit 0 without touching docker.
  CONFIRM_DB_MIGRATE=yes  authorise non-interactively (scripts/CI).

Notes:
  The active database is the one .env describes (see: ./cms db use <profile>).
  This command creates nothing: `./cms db create <name>` first, then
  `./cms db use <profile>`, then this.
USAGE
}

# Exact-key .env reader, unquoted with the shared helper so a password that
# __config_sync had to quote reads back the way the shell would read it.
get_env_val() {
  local key="$1" file="$2" raw
  raw="$(awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true)"
  env_unquote "$raw"
}

require_env_file() {
  if [[ ! -f .env ]]; then
    log_die "no .env — this step reads the active database from it. Run: ./cms config sync" 1
  fi
}

# The container stack is what every step below needs: cmsInitDB runs inside
# ${LOG_CONTAINER}, the psql probes run inside ${DB_CONTAINER}.
require_containers() {
  command -v docker >/dev/null 2>&1 \
    || log_die "docker CLI not found — run this on the host that runs the ${DB_CONTAINER} container." 1

  local missing=() name state
  for name in "$DB_CONTAINER" "$LOG_CONTAINER"; do
    if ! docker inspect "$name" >/dev/null 2>&1; then
      missing+=("$name")
      continue
    fi
    state="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo false)"
    if [[ "$state" != "true" ]]; then
      missing+=("$name")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_die "not running: ${missing[*]} — bring the core stack up first: make core" 1
  fi
}

# The profile config.toml declares active must carry POSTGRES_*, or .env is
# describing some other (possibly absent) database and every step would migrate
# the wrong one. A config.toml we cannot read is reported rather than guessed at:
# .env is what the steps actually read, and a warning beats a false hard-fail.
require_active_profile() {
  if [[ ! -r config.toml ]]; then
    log_warn "config.toml is missing or unreadable — cannot confirm which db_<profile> is active. Proceeding on .env alone."
    return 0
  fi

  local profile
  profile="$(awk '
    /^\[/ && $0 != "[core]" { in_core = 0 }
    $0 == "[core]" { in_core = 1 }
    in_core && /^ACTIVE_DATABASE[[:space:]]*=/ {
      if (match($0, /"[^"]*"/)) { print substr($0, RSTART + 1, RLENGTH - 2); exit }
    }
  ' config.toml 2>/dev/null || true)"
  profile="${profile:-default}"

  if ! grep -q "^\[db_${profile}\]" config.toml; then
    log_die "[core] ACTIVE_DATABASE is \"${profile}\" but config.toml has no [db_${profile}] section, so .env cannot describe it. Fix [core], or run: ./cms db use <profile>" 1
  fi

  # Section-scoped read: a plain grep -A would keep walking into the next
  # [db_...] section and credit this profile with a POSTGRES_DB it does not have.
  local has_db
  has_db="$(awk -v want="[db_${profile}]" '
    /^\[/ { in_section = ($0 == want) }
    in_section && /^POSTGRES_DB[[:space:]]*=/ { print "yes"; exit }
  ' config.toml 2>/dev/null || true)"

  if [[ "$has_db" != "yes" ]]; then
    log_die "[db_${profile}] has no POSTGRES_DB, so .env cannot name a database to migrate. Add it (see config.toml.example), then run: ./cms config sync" 1
  fi
  log_info "active database profile: db_${profile}"
}

require_database_exists() {
  local out
  out="$(docker exec -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "postgres" -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" 2>/dev/null || true)"
  if [[ "$(printf '%s' "$out" | tr -d '[:space:]')" != "1" ]]; then
    printf 'Create it and point a profile at it before migrating:\n' >&2
    printf '    ./cms db create %s\n    ./cms db use <profile>\n' "$DB_NAME" >&2
    log_die "database \"${DB_NAME}\" does not exist — nothing to migrate." 1
  fi
  log_info "target database: ${DB_NAME} (user ${DB_USER}, port ${DB_PORT})"
}

# Same philosophy as scripts/__db_admin.sh: an explicit non-interactive
# authorisation, or the literal word typed at a terminal. Nothing here deletes
# data — the schema steps are idempotent — so this gate is a deliberate-moment
# marker, not a destroy guard.
confirm_migrate() {
  local detail="apply the migration history to \"${DB_NAME}\" in ${DB_CONTAINER}"
  if [[ "${CONFIRM_DB_MIGRATE:-no}" == "yes" ]]; then
    log_info "CONFIRM_DB_MIGRATE=yes — proceeding with: ${detail}"
    return 0
  fi
  if [[ ! -t 0 ]]; then
    {
      echo "REFUSED: 'migrate' changes the database schema and there is no terminal to confirm on."
      echo ""
      echo "To authorise it deliberately, re-run with:"
      echo "    CONFIRM_DB_MIGRATE=yes $0"
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
  echo "To authorise non-interactively: CONFIRM_DB_MIGRATE=yes $0" >&2
  exit 1
}

# One step, its own call, fatal on a non-zero status — the run_step contract the
# ./cms lifecycle uses, so a failure names the step that produced it instead of
# surfacing as the next command's confusing error.
run_step() {
  local name="$1" target="$2"
  printf '\n== [%s] ==\n' "$name"
  if ! make "$target"; then
    log_die "\"make ${target}\" failed — ${DB_NAME} may be PARTIALLY migrated. Re-run after fixing the error; both steps are idempotent." 1
  fi
  log_info "${name} OK"
}

# Verifies the RESULT rather than the exit code: the doc's own criteria are a
# schema that exists (the marker table) and RLS forced on every table but the
# migration ledger. An empty database satisfies nothing and fails both here.
verify_migrated() {
  printf '\n== [verify] ==\n'
  local marker out rc=0 compact repo_migrations applied

  marker="$(docker exec -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT (to_regclass('public.${SCHEMA_MARKER_TABLE}') IS NOT NULL)
       AND ((SELECT count(*) FROM _prisma_migrations) > 0)" 2>/dev/null || true)"
  if [[ "$(printf '%s' "$marker" | tr -d '[:space:]')" != "t" ]]; then
    log_die "\"${DB_NAME}\" is missing the base schema marker or has no applied Prisma migrations recorded in _prisma_migrations. Re-run 'make prisma-sync' and inspect its output." 1
  fi

  # The image bakes its own snapshot of prisma/migrations; an outdated copy applies
  # fewer migrations than the repository holds and still passes the marker check.
  if [[ -d "$REPO_MIGRATIONS_DIR" ]]; then
    repo_migrations="$(find "$REPO_MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d '[:space:]')"
    applied="$(docker exec -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
      psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT count(*) FROM _prisma_migrations WHERE rolled_back_at IS NULL" 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ ! "$applied" =~ ^[0-9]+$ ]] || (( applied < repo_migrations )); then
      log_die "\"${DB_NAME}\" records ${applied:-0} applied migration(s) but the repository holds ${repo_migrations} — Prisma ran some other history (an outdated copy), so the newest migrations never applied. Re-run 'make prisma-sync' with the repository mounted." 1
    fi
  fi

  out="$(docker exec -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      ORDER BY c.relname" 2>&1)" || rc=$?
  if [[ $rc -ne 0 ]]; then
    log_die "could not read the RLS state of \"${DB_NAME}\" (psql exit ${rc}): ${out}" 1
  fi

  compact="$(printf '%s' "$out" | tr -d '[:space:]')"
  if [[ -z "$compact" || "$compact" == "$RLS_EXEMPT_TABLE" ]]; then
    log_info "RLS is enabled and forced on every application table (only ${RLS_EXEMPT_TABLE} exempt)."
    return 0
  fi
  log_die "RLS gap in \"${DB_NAME}\" — table(s) missing enabled+forced row-level security (only ${RLS_EXEMPT_TABLE} may be exempt): $(printf '%s' "$out" | tr '\n' ' ')" 1
}

main() {
  local dry_run=0 arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run) dry_run=1 ;;
      -h|--help) usage; exit 0 ;;
      *)
        echo "Error: unknown argument '${arg}'." >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  if [[ "$dry_run" -eq 1 ]]; then
    echo "# Order: role bootstrap + base schema, then the migration history (RLS lands here), then verify."
    echo "make ${MAKE_CMS_INIT}"
    echo "make ${MAKE_PRISMA_SYNC}"
    echo "# verify: to_regclass('public.${SCHEMA_MARKER_TABLE}') and ENABLE+FORCE RLS on every table but ${RLS_EXEMPT_TABLE}."
    log_info "Dry run — nothing was migrated."
    return 0
  fi

  require_env_file
  DB_USER="$(get_env_val "POSTGRES_USER" .env)"
  DB_PASS="$(get_env_val "POSTGRES_PASSWORD" .env)"
  DB_NAME="$(get_env_val "POSTGRES_DB" .env)"
  DB_PORT="$(get_env_val "POSTGRES_PORT" .env)"

  DB_USER="${DB_USER:-$DEFAULT_POSTGRES_USER}"
  DB_NAME="${DB_NAME:-$DEFAULT_POSTGRES_DB}"
  DB_PORT="${DB_PORT:-$DEFAULT_POSTGRES_PORT}"

  if [[ -z "${DB_PASS:-}" ]]; then
    log_die "POSTGRES_PASSWORD is empty or missing in .env — nothing can authenticate to \"${DB_NAME}\". Run: ./cms config sync" 1
  fi

  require_containers
  require_active_profile
  require_database_exists
  confirm_migrate

  run_step "cms-init (base schema)" "$MAKE_CMS_INIT"
  run_step "prisma-sync (roles, migration history, RLS, permissions)" "$MAKE_PRISMA_SYNC"
  verify_migrated

  printf '\n'
  log_info "\"${DB_NAME}\" is migrated and verified."
  log_info "Services that already run still hold the previous connection until they restart: ./cms deploy core"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
