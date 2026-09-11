#!/usr/bin/env bash
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

# __apply_sql.sh — apply every .sql file under admin-panel/prisma/sql/ in filename order.
# WHY: prisma db push can drop/recreate tables, so roles and RLS need re-apply after every schema sync.
# Safe to re-run: each SQL file is idempotent (DO $$ guards / IF NOT EXISTS).

CMS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CMS_ROOT"

# Source shared helpers if present
if [[ -f "scripts/__lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "scripts/__lib/common.sh"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/__lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/__lib/common.sh"
fi
declare -F log_info >/dev/null 2>&1 || log_info() { printf '[INFO] %s\n' "$*"; }
declare -F log_warn >/dev/null 2>&1 || log_warn() { printf '[WARN] %s\n' "$*" >&2; }
declare -F log_die  >/dev/null 2>&1 || log_die()  { printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }

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
CMS_SERVICE_PASSWORD="$(get_env_val "POSTGRES_SERVICE_PASSWORD" "$ENV_FILE")"
CMS_ADMIN_PASSWORD="$(get_env_val "POSTGRES_ADMIN_PASSWORD" "$ENV_FILE")"
CMS_MONITOR_PASSWORD="$(get_env_val "POSTGRES_MONITOR_PASSWORD" "$ENV_FILE")"
# Back-compat: if secrets not yet generated, warn but allow SQL files that tolerate empty
if [[ -z "$CMS_SERVICE_PASSWORD" || -z "$CMS_ADMIN_PASSWORD" || -z "$CMS_MONITOR_PASSWORD" ]]; then
  log_warn "one or more role passwords empty — run './cms config sync' to generate POSTGRES_*_PASSWORD; continuing with available values"
fi

# Fail loudly if DB container not running
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
  log_die "database container '$DB_CONTAINER' is not running — start it with 'make core' first." 1
fi

# Collect .sql files in filename order (lexicographic == timestamp order)
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
    -v "cms_service_password=$CMS_SERVICE_PASSWORD" \
    -v "cms_admin_password=$CMS_ADMIN_PASSWORD" \
    -v "cms_monitor_password=$CMS_MONITOR_PASSWORD" \
    -f - < "$sql_file"; then
    log_die "failed to apply $sql_file" 1
  fi
done

log_info "SQL apply complete."
