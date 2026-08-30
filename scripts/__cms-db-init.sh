#!/bin/bash
set -euo pipefail

###############################################################################
# CMS Database Initialization & Patching Script
###############################################################################

# Source shared helpers if present — guard for absence.
if [[ -f "__lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "__lib/common.sh"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
fi
if ! declare -F log_info >/dev/null 2>&1; then
  log_info() { printf '[INFO] %s\n' "$*"; }
fi
if ! declare -F log_warn >/dev/null 2>&1; then
  log_warn() { printf '[WARN] %s\n' "$*" >&2; }
fi
if ! declare -F log_die >/dev/null 2>&1; then
  log_die() { printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }
fi

ENV_FILE=".env.core"
if [[ ! -f "$ENV_FILE" ]]; then
  log_die "Error: $ENV_FILE not found." 1
fi

# Exact key match via awk (escapes regex metachars).
get_env_val() {
  local key="$1" file="$2"
  awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
}

DB_USER="$(get_env_val "POSTGRES_USER" "$ENV_FILE")"
DB_PASS="$(get_env_val "POSTGRES_PASSWORD" "$ENV_FILE")"
DB_NAME="$(get_env_val "POSTGRES_DB" "$ENV_FILE")"
DB_PORT="$(get_env_val "POSTGRES_PORT" "$ENV_FILE")"

DB_USER="${DB_USER:-cmsuser}"
DB_NAME="${DB_NAME:-cmsdb}"
DB_PORT="${DB_PORT:-5432}"

if [[ -z "${DB_PASS:-}" ]]; then
  log_die "POSTGRES_PASSWORD is empty or missing in $ENV_FILE" 1
fi

log_info "Database Maintenance: Starting robust initialization..."
log_info "Checking database connectivity..."

if ! docker exec -i -e PGPASSWORD="$DB_PASS" cms-database psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
  log_warn "Authentication failed or DB unreachable. Attempting password sync..."
  if ! docker exec -i -e PGPASSWORD="$DB_PASS" -e CMS_DB_PWD="$DB_PASS" -e CMS_DB_USER="$DB_USER" cms-database bash -c "psql -v pwd=\"\$CMS_DB_PWD\" -v dbuser=\"\$CMS_DB_USER\" -U \"\$CMS_DB_USER\" -d postgres -c \"ALTER USER :\\\"dbuser\\\" WITH PASSWORD :'pwd';\"" >/dev/null 2>&1; then
    log_warn "Automatic password sync failed. If this is a fresh install, this is normal. Continuing to schema check."
  fi
else
  log_info "Database connection verified."
fi

# Check if initialization is needed — quoted, pipefail-safe.
if docker exec -i -e PGPASSWORD="$DB_PASS" cms-database psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'contests'" 2>/dev/null | grep -q "1"; then
  log_info "CMS Core Schema detected. Skipping cmsInitDB."
else
  log_info "CMS Core Schema not found. Running cmsInitDB..."
  # HARD-fail on cmsInitDB — no swallow.
  docker exec -i cms-log-service cmsInitDB
fi

log_info "Applying Admin UI schema patches..."
if ! docker exec -i -e PGPASSWORD="$DB_PASS" cms-database psql -U "$DB_USER" -d "$DB_NAME" < "scripts/__fix_db_schema.sql"; then
  log_die "Failed to apply __fix_db_schema.sql" 1
fi

log_info "Database Maintenance: Complete."
