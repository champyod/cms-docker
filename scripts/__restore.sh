#!/usr/bin/env bash
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

###############################################################################
# CMS Restore Script
# Usage: cms-restore.sh <dump-file> [--with-volumes <tar>]
# - Restores into SCRATCH containers by default (never touches live cms-database)
# - --with-volumes takes the one archive __backup.sh writes, which carries every
#   volume mounted under the CMS data root, each under its own prefix
# - --force: stop core profile services, restore into real volumes
# - After restore prints verification counts
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# lib/common.sh contract: log_info/log_warn/log_die, require_disk_free_gb and the
# disk thresholds all come from the shared library. A missing library is a broken
# delivery, reported as one, rather than met by a second, divergent copy of the
# helpers — the fallback here printed `[ERROR]` where every other script prints
# `[FAIL]`, which is exactly the drift one copy of the helpers prevents.
# ---------------------------------------------------------------------------
if [[ ! -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  printf '[FAIL] %s\n' "missing ${SCRIPT_DIR}/__lib/common.sh — deliver scripts/__lib beside this script" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

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
# The volume the data tree lives in, and the prefix the archive records it under.
VOLUME_DATA="cms-data"

# The archive __backup.sh writes is one file carrying every volume mounted under the
# CMS data root, each member filed under that volume's prefix. This is the other half
# of that table — <prefix>=<docker name> — and it is what tells the restore which
# volume each prefix belongs to. WHY the table is written out here rather than read
# out of the archive: the archive names what it holds, never where it goes, and the
# compose key is not the docker name — docker-compose.yml:824-825 declares
# `cms-submissions` as `cms-submissions-contest`. Keep it in step with the
# BACKUP_VOLUMES table in __backup.sh, or a restore mounts the wrong volume.
RESTORE_VOLUMES=(
  "cms-data=cms-data"
  "cms-submissions=cms-submissions-contest"
  "cms-ranking=cms-ranking-data"
)

# How many volumes the last restore put back, and how many it could not. Printed
# beside the existing verification counts, because a restore that silently skipped a
# volume is worse than one that failed: the operator reads a clean summary and
# believes the submissions tree is back when it is still empty.
VOLUMES_RESTORED=0
VOLUMES_FAILED=0

# WHY pre-create cms_backup before pg_restore: dumps contain grants to cms_backup
# which fail with "role does not exist" on a fresh database. Creating a stub
# NOLOGIN role idempotently lets pg_restore succeed. Full role definition
# with password is applied post-restore via __apply_sql.sh --bootstrap-roles.
ensure_roles_exist() {
  local _ctr="$1"
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD_VAL" "$_ctr" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -v ON_ERROR_STOP=1 -c \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cms_backup') THEN CREATE ROLE cms_backup NOLOGIN; END IF; END \$\$;" >/dev/null 2>&1 || log_warn "Failed to pre-create roles in $_ctr (continuing anyway)"
}

# Disk guard — abort if <3GB free (common.sh contract: path floor warn)
require_disk_free_gb "$REPO_ROOT" 3 5

# ---------------------------------------------------------------------------
# Volume restore
# ---------------------------------------------------------------------------
# archive_carries_prefix <archive> <prefix> — does the archive hold anything under
# this volume's prefix?
# WHY awk over grep -q: grep -q closes the pipe on its first match, tar dies of
# SIGPIPE, and under pipefail that turns an archive which DOES carry the volume
# into a negative answer. awk reads the whole listing and decides once at the end.
archive_carries_prefix() {
  tar -tzf "$1" 2>/dev/null | awk -v prefix="$2/" '
    index($0, prefix) == 1 { found = 1 }
    END { exit found ? 0 : 1 }'
}

# extract_volume <prefix> <docker volume> <destination> <archive> — one volume's
# files, from inside the archive, into one volume at one path.
# WHY the helper mounts the destination volume at /restore and copies into it rather
# than unpacking straight onto it: the archive files every volume under its own
# prefix, so the prefix has to come off before the files land where the stack reads
# them. `tar xzf … "$prefix"` reads only that volume's members, so the archive is
# not unpacked once per volume in full — which matters when it holds contest uploads.
# WHY the destination is created first: a fresh volume has an empty root, and a copy
# into a path that does not exist fails on the first volume restored into it.
extract_volume() {
  local prefix="$1" docker_volume="$2" destination="$3" archive="$4"
  docker run --rm -v "${docker_volume}:/restore:z" -v "$(dirname -- "$archive"):/backup:ro" \
    alpine:3.22 sh -c '
      set -eu
      staging=/tmp/cms-restore-staging
      rm -rf "$staging"
      mkdir -p "$staging" "$3"
      tar xzf "/backup/$1" -C "$staging" "$2"
      cp -a "$staging/$2/." "$3/"
      rm -rf "$staging"
    ' sh "$(basename -- "$archive")" "$prefix" "$destination"
}

# extract_volume_flat <docker volume> <archive> — the whole archive into one volume.
# This is the path a pre-multi-volume archive takes: its members carry no prefix at
# all, so the prefixed rule would drop cms-data's files beside the volume mounts
# instead of inside one, and the restore would report success having restored nothing.
extract_volume_flat() {
  local docker_volume="$1" archive="$2"
  docker run --rm -v "${docker_volume}:/restore:z" -v "$(dirname -- "$archive"):/backup:ro" \
    alpine:3.22 sh -c 'set -eu; tar xzf "/backup/$1" -C /restore' sh "$(basename -- "$archive")"
}

# restore_volumes <archive> — put every volume the archive carries back where the
# stack mounts it, reporting each one by name.
# WHY warn and carry on rather than die: the database restore has already succeeded
# by the time this runs, and this script's own precedent for a step that can fail
# after that point — the role bootstrap, the dump copy — is log_warn and continue.
# Dying here would throw away a database restore over a volume. The cost of that
# policy is that "continue" must never mean "quietly", so every volume is named as
# it is restored or lost, and the count is printed with the other verification
# figures. A caller who wants a hard failure reads the count.
restore_volumes() {
  local archive="$1" entry prefix docker_volume remainder destination
  VOLUMES_RESTORED=0
  VOLUMES_FAILED=0

  if [[ ! -f "$archive" ]]; then
    log_warn "Volume tar file not found: $archive — skipping volume restore"
    return 0
  fi

  if ! archive_carries_prefix "$archive" "${VOLUME_DATA}"; then
    log_warn "Archive carries no '${VOLUME_DATA}/' prefix — it predates multi-volume backups, so it holds ${VOLUME_DATA} only and carries no submissions or ranking files"
    if extract_volume_flat "$RESTORE_DATA_VOLUME" "$archive"; then
      log_info "Volume restored: ${VOLUME_DATA} -> ${RESTORE_DATA_VOLUME}"
      VOLUMES_RESTORED=1
    else
      log_warn "Volume restore failed: ${VOLUME_DATA} -> ${RESTORE_DATA_VOLUME} — its files are not back"
      VOLUMES_FAILED=1
    fi
    return 0
  fi

  for entry in "${RESTORE_TARGETS[@]}"; do
    prefix="${entry%%=*}"
    remainder="${entry#*=}"
    docker_volume="${remainder%%=*}"
    destination="${remainder#*=}"
    if extract_volume "$prefix" "$docker_volume" "$destination" "$archive"; then
      log_info "Volume restored: ${prefix} -> ${docker_volume} at ${destination}"
      VOLUMES_RESTORED=$(( VOLUMES_RESTORED + 1 ))
    else
      log_warn "Volume restore failed: ${prefix} -> ${docker_volume} — its files are not back"
      VOLUMES_FAILED=$(( VOLUMES_FAILED + 1 ))
    fi
  done
}

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

  log_info "Creating scratch volume: $SCRATCH_VOLUME"
  if docker volume create "$SCRATCH_VOLUME" 2>/dev/null; then
    log_info "Scratch volume created"
  else
    log_warn "Failed to create scratch volume (may already exist)"
  fi

  # WHY one scratch volume and three destinations rather than three scratch volumes:
  # on the live stack cms-submissions and cms-ranking are mounted at paths INSIDE the
  # cms-data tree, so reproducing that layout in one volume shows the operator the
  # shape the containers will see. /restore stands for the CMS data root.
  RESTORE_DATA_VOLUME="$SCRATCH_VOLUME"
  RESTORE_TARGETS=(
    "cms-data=${SCRATCH_VOLUME}=/restore"
    "cms-submissions=${SCRATCH_VOLUME}=/restore/submissions"
    "cms-ranking=${SCRATCH_VOLUME}=/restore/ranking"
  )

  log_info "Starting scratch postgres container..."
  docker run --name "$SCRATCH_CONTAINER" \
    -e POSTGRES_USER="$POSTGRES_USER_VAL" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD_VAL" \
    -e POSTGRES_DB="$POSTGRES_DB_VAL" \
    -d postgres:15 >/dev/null 2>&1 || log_die "Failed to start scratch postgres container"

  log_info "Waiting for scratch postgres to be ready..."
  for i in $(seq 1 30); do
    if docker exec "$SCRATCH_CONTAINER" pg_isready -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" 2>/dev/null; then
      log_info "Scratch postgres is ready"
      break
    fi
    sleep 1
  done

  local_dump="/tmp/restore-${TS_BASE}.dump"
  log_info "Copying dump into scratch container..."
  docker cp "$DUMP_FILE" "${SCRATCH_CONTAINER}:${local_dump}" >/dev/null 2>&1 || \
    log_warn "Failed to copy dump to scratch container"

  # WHY: ensure cms_backup exists before pg_restore so grants to it succeed on fresh DB
  ensure_roles_exist "$SCRATCH_CONTAINER"

  log_info "Restoring database dump into scratch postgres..."
  if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD_VAL" "$SCRATCH_CONTAINER" \
    pg_restore -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -Fc "$local_dump" 2>/tmp/cms-restore-pgrestore.log; then
    err="$(cat /tmp/cms-restore-pgrestore.log 2>/dev/null || echo 'pg_restore failed')"
    log_warn "pg_restore failed: $err"
    log_die "Restore failed"
  fi
  log_info "Database restore complete"

  if [[ -n "$WITH_VOLUMES" ]]; then
    log_info "Restoring volumes from $WITH_VOLUMES..."
    restore_volumes "$WITH_VOLUMES"
  fi

  log_info "Running verification queries against scratch container..."

  sub_count="0"
  lob_count="0"

  sub_count="$(docker exec "$SCRATCH_CONTAINER" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM submissions;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

  lob_count="$(docker exec "$SCRATCH_CONTAINER" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM pg_largeobject;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

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
  if [[ -n "$WITH_VOLUMES" ]]; then
    # WHY printed beside the other counts: a restore that quietly left a volume out
    # reads as a clean restore, and this is the one line that says otherwise.
    log_info "  Volumes restored: ${VOLUMES_RESTORED}/${#RESTORE_TARGETS[@]} (${VOLUMES_FAILED} failed)"
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Live restore (--force mode)
# ---------------------------------------------------------------------------
log_info "Restoring into live cms-database..."

# Each volume is mounted at the CMS data root of its own container, so the three
# restores are three separate helper containers rather than one container with three
# mounts. One container that extracted to all three would report one status for
# three volumes, and an operator who could not tell which volume came back would
# have to assume the one that did not.
RESTORE_DATA_VOLUME="$VOLUME_DATA"
RESTORE_TARGETS=(
  "cms-data=${VOLUME_DATA}=/restore"
  "cms-submissions=cms-submissions-contest=/restore"
  "cms-ranking=cms-ranking-data=/restore"
)

local_dump="/tmp/live-restore-${TS_BASE}.dump"
log_info "Copying dump into live container..."
docker cp "$DUMP_FILE" "${CONTAINER_DB}:${local_dump}" >/dev/null 2>&1 || \
  log_warn "Failed to copy dump to live container"

# WHY: ensure cms_backup exists before pg_restore so grants to it succeed on fresh DB
ensure_roles_exist "$CONTAINER_DB"

log_info "Restoring database dump into live postgres..."
if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD_VAL" "$CONTAINER_DB" \
  pg_restore -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -Fc "$local_dump" 2>/tmp/cms-restore-pgrestore.log; then
  err="$(cat /tmp/cms-restore-pgrestore.log 2>/dev/null || echo 'pg_restore failed')"
  log_warn "pg_restore failed: $err"
  log_die "Restore failed"
fi
log_info "Database restore complete"

# WHY bootstrap cms_backup password after restore: ensure_roles_exist creates a
# NOLOGIN stub with no password; without the real password pg_dump as cms_backup fails.
APPLY_SQL_SCRIPT="${SCRIPT_DIR}/__apply_sql.sh"
if [[ -x "$APPLY_SQL_SCRIPT" ]]; then
  "$APPLY_SQL_SCRIPT" --bootstrap-roles || log_warn "Role bootstrap failed — pg_dump as cms_backup may fail until next prisma-sync"
else
  log_warn "$APPLY_SQL_SCRIPT missing — cms_backup password not bootstrapped"
fi

if [[ -n "$WITH_VOLUMES" ]]; then
  log_info "Restoring volumes from $WITH_VOLUMES..."
  restore_volumes "$WITH_VOLUMES"
fi

log_info "Running verification queries against live container..."

sub_count="0"
lob_count="0"

sub_count="$(docker exec "$CONTAINER_DB" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM submissions;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

lob_count="$(docker exec "$CONTAINER_DB" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SELECT count(*) FROM pg_largeobject;' 2>/dev/null | tr -d ' \r\n' || echo '0')"

log_info "Top 10 tables by rowcount:"
docker exec "$CONTAINER_DB" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c \
  "SELECT schemaname, relname, n_tup_ins + n_tup_upd + n_tup_del as total_changes FROM pg_stat_user_tables ORDER BY total_changes DESC LIMIT 10;" 2>/dev/null | \
  while IFS='|' read -r schema name changes; do
    log_info "  $schema.$name — ~$changes rows"
  done || log_warn "Could not retrieve table rowcounts"

log_info "CMS restore complete (live mode)"
log_info "  Submissions count: $sub_count"
log_info "  pg_largeobject entries: $lob_count"
if [[ -n "$WITH_VOLUMES" ]]; then
  # WHY printed beside the other counts: a restore that quietly left a volume out
  # reads as a clean restore, and this is the one line that says otherwise.
  log_info "  Volumes restored: ${VOLUMES_RESTORED}/${#RESTORE_TARGETS[@]} (${VOLUMES_FAILED} failed)"
fi
exit 0
