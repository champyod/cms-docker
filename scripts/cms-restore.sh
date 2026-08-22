#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# CMS Restore Script
# Usage: cms-restore.sh <dump-file> [--with-volumes <tar>]
# - Restores into SCRATCH containers by default (never touches live cms-database)
# - --force: stop core profile services, restore into real volume
# - After restore prints verification counts
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# lib/common.sh contract: log_info/log_warn/log_die
# ---------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/lib/common.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/lib/common.sh"
else
  log_info()  { printf '[INFO] %s\n' "$*"; }
  log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
  log_die()   { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
fi

# ---------------------------------------------------------------------------
# Load env (POSTGRES_* from .env.core).  Do not override already-exported.
# ---------------------------------------------------------------------------
for env_file in "${REPO_ROOT}/.env.core" "${REPO_ROOT}/.env" "${REPO_ROOT}/.env.infra"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$env_file" 2>/dev/null || true
    set +a
  fi
done

POSTGRES_USER_VAL="${POSTGRES_USER:-cmsuser}"
POSTGRES_DB_VAL="${POSTGRES_DB:-cmsdb}"
POSTGRES_PASSWORD_VAL="${POSTGRES_PASSWORD:-}"
CONTAINER_DB="cms-database"
VOLUME_DATA="cms-data"

# Disk guard — abort if <3GB free (common.sh contract: path floor warn)
require_disk_free_gb "$REPO_ROOT" 3 5

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  log_die "Usage: $0 <dump-file> [--with-volumes <tar>] [--force]"
fi

DUMP_FILE="$1"
WITH_VOLUMES=""
FORCE=0

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-volumes)
      if [[ -z "$2" ]]; then
        log_die "--with-volumes requires a tar file argument"
      fi
      WITH_VOLUMES="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    *)
      log_warn "Unknown argument: $1"
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate dump file exists
# ---------------------------------------------------------------------------
if [[ ! -f "$DUMP_FILE" ]]; then
  log_die "Dump file not found: $DUMP_FILE"
fi

# Extract timestamp from filename for manifest lookup
TS_BASE="$(basename "$DUMP_FILE")"
if [[ "$TS_BASE" =~ cmsdb-([0-9]{8}-[0-9]{6})\.dump ]]; then
  RESTORE_TS="${BASH_REMATCH[1]}"
else
  log_warn "Could not extract timestamp from dump filename; using 'unknown'"
  RESTORE_TS="unknown"
fi

log_info "CMS restore starting — dump: $DUMP_FILE"

# ---------------------------------------------------------------------------
# Check if docker is available
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log_die "docker not found in PATH"
fi

# ---------------------------------------------------------------------------
# Determine restore target: scratch or live
# ---------------------------------------------------------------------------
if [[ "$FORCE" -eq 1 ]]; then
  log_info "--- FORCE MODE: restoring into LIVE cms-database ---"
  log_info "Stopping core profile services first..."

  # Stop core services that depend on the database
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "cms-log-service"; then
    log_info "Stopping cms-log-service ..."
    docker stop cms-log-service || true
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "cms-resource-service"; then
    log_info "Stopping cms-resource-service ..."
    docker stop cms-resource-service || true
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "cms-scoring-service"; then
    log_info "Stopping cms-scoring-service ..."
    docker stop cms-scoring-service || true
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "cms-checker-service"; then
    log_info "Stopping cms-checker-service ..."
    docker stop cms-checker-service || true
  fi

  RESTORE_TARGET="live"
  SCRATCH_CONTAINER=""
  SCRATCH_VOLUME=""
else
  log_info "--- SCRATCH MODE: restoring into temporary containers ---"
  RESTORE_TARGET="scratch"
fi

# ---------------------------------------------------------------------------
# Scratch restore: create temp postgres + temp volume, restore, verify, teardown
# ---------------------------------------------------------------------------
if [[ "$RESTORE_TARGET" == "scratch" ]]; then
  log_info "Creating scratch postgres container (postgres:15)..."
  SCRATCH_CONTAINER="cms-restore-scratch-db"
  SCRATCH_VOLUME="cms-restore-scratch-vol"

  cleanup_scratch() {
    docker stop "$SCRATCH_CONTAINER" 2>/dev/null || true
    docker rm "$SCRATCH_CONTAINER" 2>/dev/null || true
    docker volume rm "$SCRATCH_VOLUME" 2>/dev/null || true
  }
  trap cleanup_scratch EXIT INT TERM

  # Create scratch volume
  log_info "Creating scratch volume: $SCRATCH_VOLUME"
  if docker volume create "$SCRATCH_VOLUME" 2>/dev/null; then
    log_info "Scratch volume created"
  else
    log_warn "Failed to create scratch volume (may already exist)"
  fi

  # Run scratch postgres container
  log_info "Starting scratch postgres container..."
  docker run --name "$SCRATCH_CONTAINER" \
    -e POSTGRES_USER="$POSTGRES_USER_VAL" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD_VAL" \
    -e POSTGRES_DB="$POSTGRES_DB_VAL" \
    -d postgres:15 >/dev/null 2>&1 || log_die "Failed to start scratch postgres container"

  # Wait for postgres to be ready
  log_info "Waiting for scratch postgres to be ready..."
  for i in $(seq 1 30); do
    if docker exec "$SCRATCH_CONTAINER" pg_isready -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" 2>/dev/null; then
      log_info "Scratch postgres is ready"
      break
    fi
    sleep 1
  done

  # Copy dump into scratch container and restore
  local_dump="/tmp/restore-${TS_BASE}.dump"
  log_info "Copying dump into scratch container..."
  docker cp "$DUMP_FILE" "${SCRATCH_CONTAINER}:${local_dump}" >/dev/null 2>&1 || \
    log_warn "Failed to copy dump to scratch container"

  # Restore the database dump
  log_info "Restoring database dump into scratch postgres..."
  if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD_VAL" "$SCRATCH_CONTAINER" \
    pg_restore -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -Fc "$local_dump" 2>/tmp/cms-restore-pgrestore.log; then
    err="$(cat /tmp/cms-restore-pgrestore.log 2>/dev/null || echo 'pg_restore failed')"
    log_warn "pg_restore failed: $err"
    log_die "Restore failed"
  fi
  log_info "Database restore complete"

  # Restore volumes if --with-volumes was provided
  if [[ -n "$WITH_VOLUMES" ]]; then
    if [[ ! -f "$WITH_VOLUMES" ]]; then
      log_warn "Volume tar file not found: $WITH_VOLUMES — skipping volume restore"
    else
      log_info "Restoring volumes from $WITH_VOLUMES..."
      docker run --rm -v "$SCRATCH_VOLUME:/volume:z" \
        -v "$(dirname -- "$WITH_VOLUMES"):/backup:ro" \
        alpine:3.19 sh -c "tar xzf \"/backup/$(basename -- "$WITH_VOLUMES")\" -C /volume" 2>/dev/null || \
        log_warn "Volume restore from tar had issues"
      log_info "Volume restore attempted"
    fi
  fi

  # Verification counts against scratch container
  log_info "Running verification queries against scratch container..."

  sub_count="0"
  lob_count="0"

  # Count submissions
  sub_count="$(docker exec "$SCRATCH_CONTAINER" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM submissions;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

  # Count pg_largeobject entries
  lob_count="$(docker exec "$SCRATCH_CONTAINER" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM pg_largeobject;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

  # List top 10 tables by rowcount
  log_info "Top 10 tables by rowcount:"
  docker exec "$SCRATCH_CONTAINER" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c \
    "SELECT schemaname, relname, n_tup_ins + n_tup_upd + n_tup_del as total_changes FROM pg_stat_user_tables ORDER BY total_changes DESC LIMIT 10;" 2>/dev/null | \
    while IFS='|' read -r schema name changes; do
      log_info "  $schema.$name — ~$changes rows"
    done || log_warn "Could not retrieve table rowcounts"

  # Clean up scratch container (trap will also run; disable trap after manual cleanup)
  log_info "Tearing down scratch container..."
  trap - EXIT INT TERM
  cleanup_scratch

  log_info "CMS restore complete (scratch mode)"
  log_info "  Submissions count: $sub_count"
  log_info "  pg_largeobject entries: $lob_count"
  exit 0
fi

# ---------------------------------------------------------------------------
# Live restore (--force mode)
# ---------------------------------------------------------------------------
log_info "Restoring into live cms-database..."

# Copy dump into the live container
local_dump="/tmp/live-restore-${TS_BASE}.dump"
log_info "Copying dump into live container..."
docker cp "$DUMP_FILE" "${CONTAINER_DB}:${local_dump}" >/dev/null 2>&1 || \
  log_warn "Failed to copy dump to live container"

# Restore the database dump
log_info "Restoring database dump into live postgres..."
if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD_VAL" "$CONTAINER_DB" \
  pg_restore -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -Fc "$local_dump" 2>/tmp/cms-restore-pgrestore.log; then
  err="$(cat /tmp/cms-restore-pgrestore.log 2>/dev/null || echo 'pg_restore failed')"
  log_warn "pg_restore failed: $err"
  log_die "Restore failed"
fi
log_info "Database restore complete"

# Restore volumes if --with-volumes was provided
if [[ -n "$WITH_VOLUMES" ]]; then
  if [[ ! -f "$WITH_VOLUMES" ]]; then
    log_warn "Volume tar file not found: $WITH_VOLUMES — skipping volume restore"
  else
    log_info "Restoring volumes from $WITH_VOLUMES..."
    # Use a helper container to extract into the live volume
    docker run --rm -v "$VOLUME_DATA:/volume:z" -v "$(dirname -- "$WITH_VOLUMES"):/backup:ro" \
      alpine:3.19 sh -c "tar xzf \"/backup/$(basename -- "$WITH_VOLUMES")\" -C /volume" 2>/dev/null || \
      log_warn "Volume restore from tar had issues"
    log_info "Volume restore attempted"
  fi
fi

# Verification counts against live container
log_info "Running verification queries against live container..."

sub_count="0"
lob_count="0"

# Count submissions
sub_count="$(docker exec "$CONTAINER_DB" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM submissions;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

# Count pg_largeobject entries
lob_count="$(docker exec "$CONTAINER_DB" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM pg_largeobject;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

# List top 10 tables by rowcount
log_info "Top 10 tables by rowcount:"
docker exec "$CONTAINER_DB" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c \
  "SELECT schemaname, relname, n_tup_ins + n_tup_upd + n_tup_del as total_changes FROM pg_stat_user_tables ORDER BY total_changes DESC LIMIT 10;" 2>/dev/null | \
  while IFS='|' read -r schema name changes; do
    log_info "  $schema.$name — ~$changes rows"
  done || log_warn "Could not retrieve table rowcounts"

log_info "CMS restore complete (live mode)"
log_info "  Submissions count: $sub_count"
log_info "  pg_largeobject entries: $lob_count"
exit 0
