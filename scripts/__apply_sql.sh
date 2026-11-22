#!/usr/bin/env bash
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

# Safe to re-run: every SQL file is idempotent (DO $$ guards / IF NOT EXISTS).

CMS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CMS_ROOT"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# Both modes apply one subset only: capture before the drop, role definitions before the restart.
PRE_PUSH=0
BOOTSTRAP_ROLES=0
if [[ "${1:-}" == "--pre-push" ]]; then
  PRE_PUSH=1
elif [[ "${1:-}" == "--bootstrap-roles" ]]; then
  BOOTSTRAP_ROLES=1
fi

ENV_FILE=".env"
SQL_DIR="admin-panel/prisma/sql"
DB_CONTAINER="cms-database"

# env_unquote: __config_sync quotes a value containing whitespace, so psql would otherwise receive the quotes.
get_env_val() {
  local key="$1" file="$2" raw
  raw="$(awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true)"
  env_unquote "$raw"
}

if [[ ! -f "$ENV_FILE" ]]; then
  log_die "$ENV_FILE not found — run 'make env' or './cms config sync' first." 1
fi

DB_USER="$(get_env_val "POSTGRES_USER" "$ENV_FILE")"
DB_PASS="$(get_env_val "POSTGRES_PASSWORD" "$ENV_FILE")"
DB_NAME="$(get_env_val "POSTGRES_DB" "$ENV_FILE")"
DB_USER="${DB_USER:-cmsuser}"
DB_NAME="${DB_NAME:-cmsdb}"

if [[ -z "${DB_PASS:-}" ]]; then
  log_die "POSTGRES_PASSWORD is empty or missing in $ENV_FILE" 1
fi

# Resolve role passwords (generated secrets in config.toml/.env)
CMS_BACKUP_PASSWORD="$(get_env_val "POSTGRES_BACKUP_PASSWORD" "$ENV_FILE")"
# Back-compat: if secret not yet generated, warn but allow SQL files that tolerate empty
if [[ -z "$CMS_BACKUP_PASSWORD" ]]; then
  log_warn "POSTGRES_BACKUP_PASSWORD empty — run './cms config sync' to generate it; continuing with available values"
fi

# Empty is tolerated: the password SQL leaves a role whose setting is empty untouched.
ADMIN_LOGIN_PASSWORD="$(get_env_val "ADMIN_LOGIN_PASSWORD" "$ENV_FILE")"
ADMIN_READ_PASSWORD="$(get_env_val "ADMIN_READ_PASSWORD" "$ENV_FILE")"
ADMIN_SECURITY_PASSWORD="$(get_env_val "ADMIN_SECURITY_PASSWORD" "$ENV_FILE")"
ADMIN_MIGRATE_PASSWORD="$(get_env_val "ADMIN_MIGRATE_PASSWORD" "$ENV_FILE")"
if [[ -z "$ADMIN_LOGIN_PASSWORD" || -z "$ADMIN_READ_PASSWORD" || -z "$ADMIN_SECURITY_PASSWORD" || -z "$ADMIN_MIGRATE_PASSWORD" ]]; then
  log_warn "ADMIN_*_PASSWORD empty — run './cms config sync' to generate them; those roles keep PASSWORD NULL"
fi

# Production cmsuser is NOCREATEROLE, so role DDL runs as the socket-trusted postgres OS user.
docker_exec_db_superuser() {
  docker exec -u postgres -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" "$@"
}

# Fallback: a fresh install has no postgres role, and POSTGRES_USER is still superuser until hardening.
bootstrap_psql() {
  if [[ "${BOOTSTRAP_AS_POSTGRES:-0}" -eq 1 ]]; then
    docker_exec_db_superuser "$@"
  else
    docker_exec_db "$DB_PASS" -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"
  fi
}

# A file whose header carries the marker needs the superuser phase; the normal apply skips it.
superuser_only_file() {
  grep -qE '^--[[:space:]]*superuser-only([[:space:]]|$)' "$1"
}

# WHY this catalog query: a REVOKE in migration history cannot run as the demoted owner, and a
# NOTICE-only revoke would record a fix that never happened; read the membership after the apply.
BACKUP_MEMBERSHIP_SQL="SELECT count(*) FROM pg_auth_members am JOIN pg_roles granted ON granted.oid = am.roleid JOIN pg_roles member ON member.oid = am.member WHERE granted.rolname = 'cmsuser' AND member.rolname = 'cms_backup';"

# Fail loudly if DB container not running. --pre-push stays tolerant; --bootstrap-roles must not
# report success when it could not prove the backup role is read-only.
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
  if [[ "$PRE_PUSH" -eq 1 ]]; then
    log_warn "database container '$DB_CONTAINER' is not running — skipping --pre-push capture (prisma db push will still run)"
    exit 0
  fi
  if [[ "$BOOTSTRAP_ROLES" -eq 1 ]]; then
    log_die "database container '$DB_CONTAINER' is not running — cannot bootstrap roles; start it with 'make core' and re-run (prisma-sync will not migrate without a proven cms_backup role)." 1
  fi
  log_die "database container '$DB_CONTAINER' is not running — start it with 'make core' first." 1
fi


# --pre-push applies only the capture file, before the legacy columns are dropped.
if [[ "$PRE_PUSH" -eq 1 ]]; then
  CAPTURE_FILE=""
  for _f in admin-panel/prisma/migrations/*_capture_legacy_permissions/migration.sql; do [[ -e "$_f" ]] || continue; CAPTURE_FILE="$_f"; break; done
  if [[ -z "$CAPTURE_FILE" ]] || [[ ! -f "$CAPTURE_FILE" ]]; then
    log_warn "capture file not found at $CAPTURE_FILE — skipping --pre-push"
    exit 0
  fi
  log_info "applying pre-push capture $CAPTURE_FILE to $DB_NAME via $DB_CONTAINER..."
  if ! docker_exec_db "$DB_PASS" -i \
    "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -v "cms_backup_password=$CMS_BACKUP_PASSWORD" \
    -v "admin_login_password=$ADMIN_LOGIN_PASSWORD" \
    -v "admin_read_password=$ADMIN_READ_PASSWORD" \
    -v "admin_security_password=$ADMIN_SECURITY_PASSWORD" \
    -v "admin_migrate_password=$ADMIN_MIGRATE_PASSWORD" \
    -f - < "$CAPTURE_FILE"; then
    log_warn "failed to apply $CAPTURE_FILE — continuing (prisma db push must still run)"
  else
    log_info "pre-push capture complete."
  fi
  exit 0
fi

# Role files contain CREATE ROLE and no active RLS policy, and superuser-only files are included because cmsuser cannot run their DDL.
if [[ "$BOOTSTRAP_ROLES" -eq 1 ]]; then
  if [[ ! -d "$SQL_DIR" ]]; then
    log_info "no $SQL_DIR directory — nothing to apply"
    exit 0
  fi
  # shellcheck disable=SC2207
  mapfile -t _ALL_SQL < <(find "$SQL_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
  if [[ ${#_ALL_SQL[@]} -eq 0 ]]; then
    log_info "no .sql files in $SQL_DIR — nothing to apply"
    exit 0
  fi
  SQL_FILES=()
  for _f in "${_ALL_SQL[@]}"; do
    if ! grep -q "CREATE ROLE" "$_f" && ! superuser_only_file "$_f"; then
      log_info "skipping non-role file $_f"
      continue
    fi
    # Comment lines are stripped: the backup_role header mentions ROW LEVEL SECURITY without being an RLS file.
    # The role catalog carries its role-specific policies; the bootstrap applies it as postgres even though it contains policy DDL.
    if [[ "$BOOTSTRAP_ROLES" -eq 1 && "$(basename -- "$_f")" == "20260820110000_generated_roles.sql" ]]; then
      SQL_FILES+=("$_f")
      continue
    fi
    if grep -v '^\s*--' "$_f" | grep -qE "CREATE POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY"; then
      log_info "skipping RLS-related file $_f (contains active RLS policy)"
      continue
    fi
    SQL_FILES+=("$_f")
  done
  if [[ ${#SQL_FILES[@]} -eq 0 ]]; then
    log_info "no role SQL files in $SQL_DIR — nothing to apply"
    exit 0
  fi
  BOOTSTRAP_AS_POSTGRES=0
  if docker_exec_db_superuser -tAc 'SELECT 1' >/dev/null 2>&1; then
    BOOTSTRAP_AS_POSTGRES=1
  elif docker_exec_db "$DB_PASS" -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
       "SELECT rolsuper FROM pg_roles WHERE rolname = current_user" 2>/dev/null | grep -qx 't'; then
    log_warn "no local postgres superuser in $DB_CONTAINER — $DB_USER is still superuser; applying role files as $DB_USER"
  else
    log_die "no local postgres superuser in $DB_CONTAINER and $DB_USER is NOCREATEROLE; refusing role bootstrap (start cms-database with its postgres OS user or restore a superuser)." 1
  fi
  BOOTSTRAP_USER="postgres"
  [[ "$BOOTSTRAP_AS_POSTGRES" -eq 1 ]] || BOOTSTRAP_USER="$DB_USER"
  log_info "applying ${#SQL_FILES[@]} role SQL file(s) to $DB_NAME via $DB_CONTAINER as ${BOOTSTRAP_USER} (bootstrap)..."
  for sql_file in "${SQL_FILES[@]}"; do
    log_info "→ $sql_file"
    if ! bootstrap_psql -v ON_ERROR_STOP=1 \
      -v "cms_backup_password=$CMS_BACKUP_PASSWORD" \
      -v "admin_login_password=$ADMIN_LOGIN_PASSWORD" \
      -v "admin_read_password=$ADMIN_READ_PASSWORD" \
      -v "admin_security_password=$ADMIN_SECURITY_PASSWORD" \
      -v "admin_migrate_password=$ADMIN_MIGRATE_PASSWORD" \
      -f - < "$sql_file"; then
      log_warn "failed to apply $sql_file — continuing; the membership check below decides whether the bootstrap may report success"
    fi
  done
  # WHY read pg_auth_members instead of trusting the REVOKE: on a database installed before WS-76 the
  # bootstrap connects as the demoted owner, where the revoke is refused (42501) and the file can only
  # warn. A scrolling warning is how the owner-equivalent backup role survived, so the catalog decides.
  _membership_status=0
  if [[ "$BOOTSTRAP_AS_POSTGRES" -eq 1 ]]; then
    _membership="$(docker_exec_db_superuser -X -tA -v ON_ERROR_STOP=1 -c "$BACKUP_MEMBERSHIP_SQL" 2>&1)" || _membership_status=$?
  else
    _membership="$(docker_exec_db "$DB_PASS" \
      "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -X -tA -v ON_ERROR_STOP=1 \
      -c "$BACKUP_MEMBERSHIP_SQL" 2>&1)" || _membership_status=$?
  fi
  if [[ "${_membership_status:-0}" -ne 0 ]]; then
    log_die "could not read pg_auth_members — cannot prove cms_backup is read-only: $_membership" 1
  fi
  _membership="$(printf '%s' "$_membership" | tr -d '[:space:]')"
  if [[ "$_membership" != "0" ]]; then
    log_die "cms_backup is still a member of cmsuser (WS-76): a member of the owner inherits its UPDATE and DDL on every object cmsuser owns. REVOKE needs a superuser or ADMIN OPTION on cmsuser — run the one-time revoke as a superuser (scripts/__db_admin.sh documents the postgres --single route) and re-run the bootstrap. Dumps are unaffected: cms_backup keeps BYPASSRLS and its SELECT grants." 1
  fi
  log_info "cms_backup holds no membership in cmsuser (WS-76: the backup role is SELECT-only)."
  log_info "role bootstrap complete."
  exit 0
fi

if [[ ! -d "$SQL_DIR" ]]; then
  log_info "no $SQL_DIR directory — nothing to apply"
  exit 0
fi

# shellcheck disable=SC2207
mapfile -t _NORMAL_SQL < <(find "$SQL_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
# Applied by --bootstrap-roles already; the application role would only fail on them here.
SQL_FILES=()
for _f in "${_NORMAL_SQL[@]}"; do
  if superuser_only_file "$_f"; then
    log_info "skipping superuser-only file $_f (applied by --bootstrap-roles as postgres)"
    continue
  fi
  SQL_FILES+=("$_f")
done
if [[ ${#SQL_FILES[@]} -eq 0 ]]; then
  log_info "no .sql files in $SQL_DIR — nothing to apply"
  exit 0
fi

log_info "applying ${#SQL_FILES[@]} SQL file(s) to $DB_NAME via $DB_CONTAINER..."

for sql_file in "${SQL_FILES[@]}"; do
  log_info "→ $sql_file"
  if ! docker_exec_db "$DB_PASS" -i \
    "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -v "cms_backup_password=$CMS_BACKUP_PASSWORD" \
    -v "admin_login_password=$ADMIN_LOGIN_PASSWORD" \
    -v "admin_read_password=$ADMIN_READ_PASSWORD" \
    -v "admin_security_password=$ADMIN_SECURITY_PASSWORD" \
    -v "admin_migrate_password=$ADMIN_MIGRATE_PASSWORD" \
    -f - < "$sql_file"; then
    log_die "failed to apply $sql_file" 1
  fi
done

# Verify the RLS result, not the apply exit code: ENABLE/FORCE on a mistyped table succeeds silently.
log_info "verifying RLS (ENABLE + FORCE) on expected application tables..."
_RLS_EXPECTED_FILE=""
for _f in admin-panel/prisma/migrations/*_rls_enable/migration.sql; do [[ -e "$_f" ]] || continue; _RLS_EXPECTED_FILE="$_f"; break; done
_RLS_EXPECTED_TABLES=()
if [[ -n "$_RLS_EXPECTED_FILE" ]] && [[ -f "$_RLS_EXPECTED_FILE" ]]; then
  # WHY grep source of truth: file contains `to_regclass('public.<name>')` guards per model
  while IFS= read -r _t; do _RLS_EXPECTED_TABLES+=("$_t"); done < <(grep -o "to_regclass('public\.[^']*')" "$_RLS_EXPECTED_FILE" | sed "s/.*public\.//;s/'.*//" | sort -u)
fi
if [[ ${#_RLS_EXPECTED_TABLES[@]} -eq 0 ]]; then
  log_warn "RLS check skipped: could not derive expected tables from $_RLS_EXPECTED_FILE"
else
  # WHY build VALUES list: single-query set-membership is simpler than per-table roundtrips and keeps the infra-vs-gap contract clear.
  _RLS_LIST_SQL=""
  for _t in "${_RLS_EXPECTED_TABLES[@]}"; do _RLS_LIST_SQL+=",('$_t')"; done
  _RLS_LIST_SQL="${_RLS_LIST_SQL#,}"
  _RLS_RC=0
  _RLS_COUNT="$(docker_exec_db "$DB_PASS" -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT count(*) FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND NOT c.relrowsecurity;" 2>&1)" || _RLS_RC=$?
  if [[ $_RLS_RC -ne 0 ]]; then
    # WHY log_warn not log_die: a docker/psql execution failure (container gone, network hiccup) is infra, not a security verdict — must not mask or fake a gap as pass/fail.
    log_warn "RLS ENABLE check skipped: docker/psql execution failed (exit $_RLS_RC): $_RLS_COUNT"
  else
    _RLS_COUNT_TRIMMED="$(printf '%s' "$_RLS_COUNT" | tr -d '[:space:]')"
    if [[ "$_RLS_COUNT_TRIMMED" =~ ^[0-9]+$ ]] && [[ "$_RLS_COUNT_TRIMMED" -gt 0 ]]; then
      _RLS_TABLES_RC=0
      _RLS_TABLES="$(docker_exec_db "$DB_PASS" -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT e.tbl FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND NOT c.relrowsecurity ORDER BY e.tbl;" 2>&1)" || _RLS_TABLES_RC=$?
      if [[ $_RLS_TABLES_RC -ne 0 ]]; then
        log_die "RLS ENABLE gap: ${_RLS_COUNT_TRIMMED} expected table(s) without RLS (failed to fetch names, psql exit $_RLS_TABLES_RC): $_RLS_TABLES" 1
      fi
      _RLS_TABLES_FMT="$(printf '%s' "$_RLS_TABLES" | tr '\n' ' ' | xargs)"
      log_die "RLS ENABLE gap: ${_RLS_COUNT_TRIMMED} expected table(s) without RLS: ${_RLS_TABLES_FMT}" 1
    elif [[ ! "$_RLS_COUNT_TRIMMED" =~ ^[0-9]+$ ]]; then
      log_warn "RLS ENABLE check skipped: unexpected psql output: $_RLS_COUNT"
    else
      log_info "RLS ENABLE check passed (0 expected tables without RLS)"
    fi
  fi
  _RLS_FORCE_RC=0
  _RLS_FORCE_COUNT="$(docker_exec_db "$DB_PASS" -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT count(*) FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;" 2>&1)" || _RLS_FORCE_RC=$?
  if [[ $_RLS_FORCE_RC -ne 0 ]]; then
    log_warn "RLS FORCE check skipped: docker/psql execution failed (exit $_RLS_FORCE_RC): $_RLS_FORCE_COUNT"
  else
    _RLS_FORCE_TRIMMED="$(printf '%s' "$_RLS_FORCE_COUNT" | tr -d '[:space:]')"
    if [[ "$_RLS_FORCE_TRIMMED" =~ ^[0-9]+$ ]] && [[ "$_RLS_FORCE_TRIMMED" -gt 0 ]]; then
      _RLS_FORCE_TABLES_RC=0
      _RLS_FORCE_TABLES="$(docker_exec_db "$DB_PASS" -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT e.tbl FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity ORDER BY e.tbl;" 2>&1)" || _RLS_FORCE_TABLES_RC=$?
      if [[ $_RLS_FORCE_TABLES_RC -ne 0 ]]; then
        log_die "RLS FORCE gap: ${_RLS_FORCE_TRIMMED} expected table(s) with RLS but without FORCE (failed to fetch names, psql exit $_RLS_FORCE_TABLES_RC): $_RLS_FORCE_TABLES" 1
      fi
      _RLS_FORCE_FMT="$(printf '%s' "$_RLS_FORCE_TABLES" | tr '\n' ' ' | xargs)"
      log_die "RLS FORCE gap: ${_RLS_FORCE_TRIMMED} expected table(s) with RLS but without FORCE: ${_RLS_FORCE_FMT}" 1
    elif [[ ! "$_RLS_FORCE_TRIMMED" =~ ^[0-9]+$ ]]; then
      log_warn "RLS FORCE check skipped: unexpected psql output: $_RLS_FORCE_COUNT"
    else
      log_info "RLS FORCE check passed (0 expected tables with RLS but without FORCE)"
    fi
  fi
fi

log_info "SQL apply complete."
