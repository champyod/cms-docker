#!/usr/bin/env bash
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

# __apply_sql.sh — apply every .sql file under admin-panel/prisma/sql/ in filename order.
# WHY: roles are limited to cmsuser (owner, NOBYPASSRLS) and cms_backup (BYPASSRLS, member of cmsuser)
# for least privilege; post-restart schema sync runs prisma migrate deploy and re-applies roles/RLS.
# Safe to re-run: each SQL file is idempotent (DO $$ guards / IF NOT EXISTS).

CMS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CMS_ROOT"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# WHY --pre-push: capture legacy permissions BEFORE prisma db push drops the columns.
# In that mode apply ONLY the capture file and be tolerant (never abort the push).
# WHY --bootstrap-roles: apply ONLY role-definition files BEFORE the restart so
# cms_backup can connect with its real password; RLS/hardening are deferred to
# the post-restart full apply after new code is running.
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

# Resolve DB credentials from .env (exact key match via awk — avoids regex metachars)
get_env_val() {
  local key="$1" file="$2"
  awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); gsub(/^"|"$/, "", v); gsub(/^\x27|\x27$/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
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

# Fail loudly if DB container not running (tolerant in --pre-push / --bootstrap-roles so the update still runs)
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
  if [[ "$PRE_PUSH" -eq 1 ]]; then
    log_warn "database container '$DB_CONTAINER' is not running — skipping --pre-push capture (prisma db push will still run)"
    exit 0
  fi
  if [[ "$BOOTSTRAP_ROLES" -eq 1 ]]; then
    log_warn "database container '$DB_CONTAINER' is not running — skipping --bootstrap-roles (prisma-sync will retry after the restart)"
    exit 0
  fi
  log_die "database container '$DB_CONTAINER' is not running — start it with 'make core' first." 1
fi


# Collect .sql files in filename order (lexicographic == timestamp order)
# WHY --pre-push: only the capture file is applied before the push so legacy booleans
# are saved before they are dropped; missing file is a no-op (fresh clone may not have it yet).
if [[ "$PRE_PUSH" -eq 1 ]]; then
  CAPTURE_FILE="$SQL_DIR/20260810120000_capture_legacy_permissions.sql"
  if [[ ! -f "$CAPTURE_FILE" ]]; then
    log_warn "capture file not found at $CAPTURE_FILE — skipping --pre-push"
    exit 0
  fi
  log_info "applying pre-push capture $CAPTURE_FILE to $DB_NAME via $DB_CONTAINER..."
  if ! docker exec -i \
    -e PGPASSWORD="$DB_PASS" \
    "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -v "cms_backup_password=$CMS_BACKUP_PASSWORD" \
    -f - < "$CAPTURE_FILE"; then
    log_warn "failed to apply $CAPTURE_FILE — continuing (prisma db push must still run)"
  else
    log_info "pre-push capture complete."
  fi
  exit 0
fi

# WHY --bootstrap-roles: apply ONLY role-definition files BEFORE the restart so
# cms_backup can connect; RLS/hardening are deliberately deferred to post-restart.
# WHY content-based selector: role files contain CREATE ROLE; RLS/hardening do not.
# Future role migrations will also contain CREATE ROLE and be auto-included without
# updating a hardcoded filename list. Additional exclusion of active RLS (CREATE POLICY
# / ENABLE ROW LEVEL SECURITY in non-comment SQL) is defense-in-depth against a
# future file that might mention CREATE ROLE in a comment while being RLS-related.
# Comment lines are stripped for the RLS check to avoid false positives from
# explanatory comments (e.g., backup_role mentions RLS in its header comment).
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
    if ! grep -q "CREATE ROLE" "$_f"; then
      log_info "skipping non-role file $_f"
      continue
    fi
    # WHY strip comment lines: backup_role header mentions ROW LEVEL SECURITY in a comment
    # but is not an RLS policy file; check active SQL only.
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
  log_info "applying ${#SQL_FILES[@]} role SQL file(s) to $DB_NAME via $DB_CONTAINER (bootstrap)..."
  for sql_file in "${SQL_FILES[@]}"; do
    log_info "→ $sql_file"
    if ! docker exec -i \
      -e PGPASSWORD="$DB_PASS" \
      "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
      -v "cms_backup_password=$CMS_BACKUP_PASSWORD" \
      -f - < "$sql_file"; then
      log_warn "failed to apply $sql_file — continuing (prisma-sync will retry after the restart)"
    fi
  done
  log_info "role bootstrap complete."
  exit 0
fi

if [[ ! -d "$SQL_DIR" ]]; then
  log_info "no $SQL_DIR directory — nothing to apply"
  exit 0
fi

# shellcheck disable=SC2207
mapfile -t SQL_FILES < <(find "$SQL_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
if [[ ${#SQL_FILES[@]} -eq 0 ]]; then
  log_info "no .sql files in $SQL_DIR — nothing to apply"
  exit 0
fi

log_info "applying ${#SQL_FILES[@]} SQL file(s) to $DB_NAME via $DB_CONTAINER..."

for sql_file in "${SQL_FILES[@]}"; do
  log_info "→ $sql_file"
  if ! docker exec -i \
    -e PGPASSWORD="$DB_PASS" \
    "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -v "cms_backup_password=$CMS_BACKUP_PASSWORD" \
    -f - < "$sql_file"; then
    log_die "failed to apply $sql_file" 1
  fi
done

# WHY post-apply RLS assertion: ENABLE/FORCE with a mistyped table succeeds silently (DO $$ guard) and leaves the table unprotected. Verify the RESULT, not just the apply exit code.
# WHY full-apply only: --pre-push and --bootstrap-roles exit before this point; they apply only a subset (capture file / role files) where RLS is deliberately not yet complete, so a check there would false-fail and violate their tolerant contract. Full apply is the only mode where all RLS files have been applied.
# WHY scope to expected set: the generated 20260820125500_rls_enable.sql enumerates exactly the application tables that must have RLS. Checking "all public tables" is brittle: a maintenance/legacy table without RLS would false-fail and abort `make prisma-sync`.
log_info "verifying RLS (ENABLE + FORCE) on expected application tables..."
_RLS_EXPECTED_FILE="$SQL_DIR/20260820125500_rls_enable.sql"
_RLS_EXPECTED_TABLES=()
if [[ -f "$_RLS_EXPECTED_FILE" ]]; then
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
  _RLS_COUNT="$(docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT count(*) FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND NOT c.relrowsecurity;" 2>&1)" || _RLS_RC=$?
  if [[ $_RLS_RC -ne 0 ]]; then
    # WHY log_warn not log_die: a docker/psql execution failure (container gone, network hiccup) is infra, not a security verdict — must not mask or fake a gap as pass/fail.
    log_warn "RLS ENABLE check skipped: docker/psql execution failed (exit $_RLS_RC): $_RLS_COUNT"
  else
    _RLS_COUNT_TRIMMED="$(printf '%s' "$_RLS_COUNT" | tr -d '[:space:]')"
    if [[ "$_RLS_COUNT_TRIMMED" =~ ^[0-9]+$ ]] && [[ "$_RLS_COUNT_TRIMMED" -gt 0 ]]; then
      _RLS_TABLES_RC=0
      _RLS_TABLES="$(docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT e.tbl FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND NOT c.relrowsecurity ORDER BY e.tbl;" 2>&1)" || _RLS_TABLES_RC=$?
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
  _RLS_FORCE_COUNT="$(docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT count(*) FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;" 2>&1)" || _RLS_FORCE_RC=$?
  if [[ $_RLS_FORCE_RC -ne 0 ]]; then
    log_warn "RLS FORCE check skipped: docker/psql execution failed (exit $_RLS_FORCE_RC): $_RLS_FORCE_COUNT"
  else
    _RLS_FORCE_TRIMMED="$(printf '%s' "$_RLS_FORCE_COUNT" | tr -d '[:space:]')"
    if [[ "$_RLS_FORCE_TRIMMED" =~ ^[0-9]+$ ]] && [[ "$_RLS_FORCE_TRIMMED" -gt 0 ]]; then
      _RLS_FORCE_TABLES_RC=0
      _RLS_FORCE_TABLES="$(docker exec -i -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "WITH expected(tbl) AS (VALUES ${_RLS_LIST_SQL}) SELECT e.tbl FROM expected e JOIN pg_class c ON c.relname=e.tbl JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public' WHERE c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity ORDER BY e.tbl;" 2>&1)" || _RLS_FORCE_TABLES_RC=$?
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
