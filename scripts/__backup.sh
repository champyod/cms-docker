#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# CMS Full Backup Script
# - Full logical pg_dump via docker exec (PGPASSWORD in env, not argv)
# - Volume tar via helper container (cms-data:ro mount)
# - manifest.json, rotation across BOTH dirs, disk guard, Discord webhook
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# lib/common.sh contract: log_info/log_warn/log_die, require_disk_free_gb
# File may not exist at runtime — source if present, else provide fallbacks.
# ---------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/__lib/common.sh"
else
  log_info()  { printf '[INFO] %s\n' "$*"; }
  log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
  log_die()   { printf '[FAIL] %s\n' "${1:-fatal error}" >&2; exit "${2:-1}"; }
  require_disk_free_gb() {
    local target_path="${1:?require_disk_free_gb: <path> required}"
    local floor_gb="${2:-3}"
    local warn_gb="${3:-5}"
    local avail_kb
    avail_kb="$(df -Pk "$target_path" 2>/dev/null | awk 'NR==2{print $4}')"
    if [[ -z "$avail_kb" || ! "$avail_kb" =~ ^[0-9]+$ ]]; then
      log_warn "require_disk_free_gb: cannot determine free space for $target_path — skipping guard"
      return 0
    fi
    local avail_gb
    avail_gb="$(awk "BEGIN{printf \"%.2f\", $avail_kb/1024/1024}")"
    local avail_int="${avail_gb%%.*}"
    if ! [[ "$avail_int" =~ ^[0-9]+$ ]]; then avail_int=0; fi
    if (( avail_int < floor_gb )); then
      log_die "Insufficient disk space on $target_path: ${avail_gb}GB free < ${floor_gb}GB required" 2
    fi
    if (( avail_int < warn_gb )); then
      log_warn "disk space low: ${avail_gb}G < warn ${warn_gb}G at ${target_path}"
    fi
  }
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

# ---------------------------------------------------------------------------
# Config (keep BACKUP_* rotation envs compatible with legacy monitor.sh)
# ---------------------------------------------------------------------------
BACKUP_ROOT="${BACKUP_DIR:-${REPO_ROOT}/backups}"
BACKUP_DB_DIR="${BACKUP_ROOT}/db"
BACKUP_VOL_DIR="${BACKUP_ROOT}/volumes"
MANIFEST_FILE="${BACKUP_ROOT}/manifest.json"

# Rotation envs — support both new and legacy names
BACKUP_MAX_COUNT="${BACKUP_MAX_COUNT:-${MAX_BACKUPS:-50}}"
BACKUP_MAX_AGE_DAYS="${BACKUP_MAX_AGE_DAYS:-${MAX_AGE_DAYS:-10}}"
BACKUP_MAX_SIZE_GB="${BACKUP_MAX_SIZE_GB:-${MAX_SIZE_GB:-5}}"

# Webhook — env only (never argv)
WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-${WEBHOOK_URL:-}}"
ROLE_ID="${DISCORD_ROLE_ID:-${ROLE_ID:-}}"

POSTGRES_USER_VAL="${POSTGRES_USER:-cmsuser}"
POSTGRES_DB_VAL="${POSTGRES_DB:-cmsdb}"
POSTGRES_PASSWORD_VAL="${POSTGRES_PASSWORD:-}"

CONTAINER_DB="cms-database"
VOLUME_DATA="cms-data"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
json_escape() {
  # JSON-escape a string via python3 (fallback to naive escaping)
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
  else
    printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g; s/\r/\\r/g; s/\t/\\t/g')"
  fi
}

send_discord() {
  local message="$1"
  local color="${2:-3447003}"
  local mention="${3:-false}"
  [[ -z "$WEBHOOK_URL" ]] && return 0

  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local payload
  local escaped_msg
  escaped_msg="$(json_escape "$message")"
  # json_escape already returns quoted string — strip outer quotes for embed
  # Instead build payload via python to guarantee escaping
  if command -v python3 >/dev/null 2>&1; then
    payload="$(python3 -c '
import json,sys
msg=sys.argv[1]
color=int(sys.argv[2])
ts=sys.argv[3]
role=sys.argv[4]
mention=sys.argv[5]
embed={"title":"CMS Backup System","description":msg,"color":color,"timestamp":ts}
body={"embeds":[embed]}
if mention=="true" and role:
    body["content"]=f"<@&{role}>"
print(json.dumps(body))
' "$message" "$color" "$ts" "$ROLE_ID" "$mention")"
  else
    if [[ "$mention" == "true" && -n "$ROLE_ID" ]]; then
      payload="{\"content\": \"<@&${ROLE_ID}>\", \"embeds\": [{\"title\": \"CMS Backup System\", \"description\": ${escaped_msg}, \"color\": ${color}, \"timestamp\": \"${ts}\"}]}"
    else
      payload="{\"embeds\": [{\"title\": \"CMS Backup System\", \"description\": ${escaped_msg}, \"color\": ${color}, \"timestamp\": \"${ts}\"}]}"
    fi
  fi
  curl -s -H "Content-Type: application/json" -X POST -d "$payload" "$WEBHOOK_URL" >/dev/null 2>&1 || log_warn "Discord webhook POST failed"
}

file_size_bytes() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0
}

get_pg_version() {
  # Try inside container first
  local ver=""
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_DB"; then
    ver="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD_VAL" "$CONTAINER_DB" psql -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -t -A -c 'SHOW server_version;' 2>/dev/null | tr -d ' \r\n' || true)"
  fi
  if [[ -z "$ver" ]]; then
    # Fallback: image version or postgres --version
    ver="$(docker exec "$CONTAINER_DB" postgres --version 2>/dev/null | awk '{print $NF}' || true)"
  fi
  if [[ -z "$ver" ]]; then
    ver="unknown"
  fi
  printf '%s' "$ver"
}

# ---------------------------------------------------------------------------
# Rotation — operates on timestamp sets across BOTH dirs, always keeps ≥1 set
# ---------------------------------------------------------------------------
list_backup_timestamps() {
  # Print sorted unique timestamps (oldest first) derived from filenames
  # cmsdb-YYYYmmdd-HHMMSS.dump  and cms-data-YYYYmmdd-HHMMSS.tar.gz
  local t
  {
    ls -1 "${BACKUP_DB_DIR}"/cmsdb-*.dump 2>/dev/null | xargs -r -n1 basename | sed -n 's/^cmsdb-\(.*\)\.dump$/\1/p'
    ls -1 "${BACKUP_VOL_DIR}"/cms-data-*.tar.gz 2>/dev/null | xargs -r -n1 basename | sed -n 's/^cms-data-\(.*\)\.tar\.gz$/\1/p'
  } | sort -u
}

delete_backup_set() {
  local ts="$1"
  local f
  for f in "${BACKUP_DB_DIR}/cmsdb-${ts}.dump" "${BACKUP_DB_DIR}/cmsdb-${ts}.dump.sha256" "${BACKUP_VOL_DIR}/cms-data-${ts}.tar.gz" "${BACKUP_VOL_DIR}/cms-data-${ts}.tar.gz.sha256"; do
    if [[ -f "$f" ]]; then
      rm -f "$f"
      log_info "Rotation: removed $f"
    fi
  done
}

apply_rotation() {
  local timestamps
  mapfile -t timestamps < <(list_backup_timestamps)
  local total_sets=${#timestamps[@]}
  if (( total_sets == 0 )); then
    return 0
  fi

  local deleted_any=0

  # 1) By count
  if [[ "$BACKUP_MAX_COUNT" =~ ^[0-9]+$ ]] && (( BACKUP_MAX_COUNT > 0 )); then
    while (( ${#timestamps[@]} > BACKUP_MAX_COUNT )); do
      # Always keep ≥1 newest — break if only 1 left
      if (( ${#timestamps[@]} <= 1 )); then break; fi
      local oldest="${timestamps[0]}"
      delete_backup_set "$oldest"
      deleted_any=1
      mapfile -t timestamps < <(list_backup_timestamps)
      if (( ${#timestamps[@]} == 0 )); then break; fi
    done
  fi

  # 2) By age
  if [[ "$BACKUP_MAX_AGE_DAYS" =~ ^[0-9]+$ ]] && (( BACKUP_MAX_AGE_DAYS > 0 )); then
    local now
    now="$(date +%s)"
    # Re-list after count pruning
    mapfile -t timestamps < <(list_backup_timestamps)
    for ts in "${timestamps[@]}"; do
      if (( ${#timestamps[@]} <= 1 )); then break; fi
      # Find the oldest file's mtime among the set
      local ref_file=""
      if [[ -f "${BACKUP_DB_DIR}/cmsdb-${ts}.dump" ]]; then
        ref_file="${BACKUP_DB_DIR}/cmsdb-${ts}.dump"
      elif [[ -f "${BACKUP_VOL_DIR}/cms-data-${ts}.tar.gz" ]]; then
        ref_file="${BACKUP_VOL_DIR}/cms-data-${ts}.tar.gz"
      else
        continue
      fi
      local mtime
      mtime="$(stat -c %Y "$ref_file" 2>/dev/null || stat -f %m "$ref_file" 2>/dev/null || echo "$now")"
      local age_days=$(( (now - mtime) / 86400 ))
      if (( age_days > BACKUP_MAX_AGE_DAYS )); then
        # Ensure we keep newest ≥1
        local newest="${timestamps[-1]}"
        if [[ "$ts" == "$newest" ]]; then continue; fi
        delete_backup_set "$ts"
        deleted_any=1
      fi
    done
    mapfile -t timestamps < <(list_backup_timestamps)
  fi

  # 3) By total size
  if [[ "$BACKUP_MAX_SIZE_GB" =~ ^[0-9]+$ ]] && (( BACKUP_MAX_SIZE_GB > 0 )); then
    local max_bytes=$(( BACKUP_MAX_SIZE_GB * 1024 * 1024 * 1024 ))
    # Use du -sb if available
    local total_bytes
    total_bytes="$(du -sb "${BACKUP_DB_DIR}" "${BACKUP_VOL_DIR}" 2>/dev/null | awk '{s+=$1} END{print s+0}')"
    if [[ -z "$total_bytes" || "$total_bytes" == "0" ]]; then
      total_bytes="$(du -cb "${BACKUP_DB_DIR}"/* "${BACKUP_VOL_DIR}"/* 2>/dev/null | tail -1 | awk '{print $1}')"
      total_bytes="${total_bytes:-0}"
    fi
    mapfile -t timestamps < <(list_backup_timestamps)
    # Sort timestamps ascending already
    while (( total_bytes > max_bytes )); do
      if (( ${#timestamps[@]} <= 1 )); then break; fi
      local oldest="${timestamps[0]}"
      # Calculate size of oldest set
      local set_bytes=0
      for f in "${BACKUP_DB_DIR}/cmsdb-${oldest}.dump" "${BACKUP_DB_DIR}/cmsdb-${oldest}.dump.sha256" "${BACKUP_VOL_DIR}/cms-data-${oldest}.tar.gz" "${BACKUP_VOL_DIR}/cms-data-${oldest}.tar.gz.sha256"; do
        if [[ -f "$f" ]]; then
          local sz
          sz="$(file_size_bytes "$f")"
          set_bytes=$(( set_bytes + sz ))
        fi
      done
      delete_backup_set "$oldest"
      deleted_any=1
      total_bytes=$(( total_bytes - set_bytes ))
      mapfile -t timestamps < <(list_backup_timestamps)
      if (( ${#timestamps[@]} == 0 )); then break; fi
    done
  fi

  if (( deleted_any == 1 )); then
    send_discord "🧹 Backup rotation applied." 15844367 "false" || true
  fi
}

# ---------------------------------------------------------------------------
# Main backup
# ---------------------------------------------------------------------------
run_backup() {
  log_info "CMS backup starting — backup root: $BACKUP_ROOT"

  # Disk guard — abort if <3GB free on backup filesystem
  require_disk_free_gb "$BACKUP_ROOT" 3 5

  mkdir -p -m 700 "$BACKUP_DB_DIR" "$BACKUP_VOL_DIR"
  chmod 700 "$BACKUP_DB_DIR" "$BACKUP_VOL_DIR" 2>/dev/null || true
  chmod 700 "$BACKUP_ROOT" 2>/dev/null || true

  if [[ -z "$POSTGRES_PASSWORD_VAL" ]]; then
    log_warn "POSTGRES_PASSWORD is empty — pg_dump may fail if auth required"
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log_die "docker not found in PATH"
  fi

  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_DB"; then
    local msg="Backup failed: container $CONTAINER_DB not running"
    log_warn "$msg"
    send_discord "❌ **Backup Failed** — $msg" 16711680 "true"
    return 1
  fi

  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local db_tmp="/tmp/cmsdb-${ts}.dump"
  local db_file="${BACKUP_DB_DIR}/cmsdb-${ts}.dump"
  local db_sha_file="${db_file}.sha256"
  local vol_file="${BACKUP_VOL_DIR}/cms-data-${ts}.tar.gz"
  local vol_sha_file="${vol_file}.sha256"

  # Ensure container tmp is cleaned on failure
  local cleanup_done=0
  cleanup_container_tmp() {
    if (( cleanup_done == 0 )); then
      docker exec "$CONTAINER_DB" rm -f "$db_tmp" 2>/dev/null || true
    fi
  }
  trap cleanup_container_tmp EXIT

  # 1) Full logical backup — credentials via docker exec -e PGPASSWORD (never on host argv)
  log_info "Running pg_dump (Fc) inside $CONTAINER_DB ..."
  if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD_VAL" "$CONTAINER_DB" pg_dump -U "$POSTGRES_USER_VAL" -d "$POSTGRES_DB_VAL" -Fc -f "$db_tmp" 2>/tmp/cms-backup-pgdump.log; then
    local err
    err="$(cat /tmp/cms-backup-pgdump.log 2>/dev/null || echo 'pg_dump failed')"
    log_warn "pg_dump failed: $err"
    send_discord "❌ **Backup Failed** — pg_dump error: $err" 16711680 "true"
    return 1
  fi

  log_info "Copying dump from container to host ..."
  if ! docker cp "${CONTAINER_DB}:${db_tmp}" "$db_file"; then
    log_warn "docker cp failed"
    send_discord "❌ **Backup Failed** — docker cp failed" 16711680 "true"
    return 1
  fi
  docker exec "$CONTAINER_DB" rm -f "$db_tmp" 2>/dev/null || true
  cleanup_done=1
  trap - EXIT

  chmod 600 "$db_file" 2>/dev/null || true
  sha256sum "$db_file" | awk '{print $1"  " $2}' > "$db_sha_file"
  chmod 600 "$db_sha_file" 2>/dev/null || true
  local db_sha
  db_sha="$(awk '{print $1}' "$db_sha_file")"
  local db_bytes
  db_bytes="$(file_size_bytes "$db_file")"

  # 2) Volume backup via helper container (ro mount)
  log_info "Archiving volume $VOLUME_DATA ..."
  # Use helper container mounting volume read-only
  local vol_image="alpine:3.19"
  # Pull quietly if needed (ignore failure — try busybox fallback)
  docker pull "$vol_image" >/dev/null 2>&1 || true
  if ! docker run --rm -v "${VOLUME_DATA}:/volume:ro" -v "${BACKUP_VOL_DIR}:/backup" "$vol_image" sh -c "tar czf \"/backup/cms-data-${ts}.tar.gz\" -C /volume . 2>/tmp/tar.log || (cat /tmp/tar.log; exit 1)"; then
    # Fallback to busybox
    if ! docker run --rm -v "${VOLUME_DATA}:/volume:ro" -v "${BACKUP_VOL_DIR}:/backup" busybox sh -c "tar czf \"/backup/cms-data-${ts}.tar.gz\" -C /volume ."; then
      log_warn "Volume backup failed"
      send_discord "❌ **Backup Failed** — volume tar failed" 16711680 "true"
      # Keep DB dump but warn — not fatal for DB part; still mark as failed
      return 1
    fi
  fi

  if [[ ! -f "$vol_file" ]]; then
    log_warn "Volume tar not created: $vol_file"
    send_discord "❌ **Backup Failed** — volume tar missing" 16711680 "true"
    return 1
  fi

  chmod 600 "$vol_file" 2>/dev/null || true
  sha256sum "$vol_file" | awk '{print $1"  " $2}' > "$vol_sha_file"
  chmod 600 "$vol_sha_file" 2>/dev/null || true
  local vol_sha
  vol_sha="$(awk '{print $1}' "$vol_sha_file")"
  local vol_bytes
  vol_bytes="$(file_size_bytes "$vol_file")"

  local pg_ver
  pg_ver="$(get_pg_version)"
  local total_bytes=$(( db_bytes + vol_bytes ))

  # 3) manifest.json append
  log_info "Updating manifest $MANIFEST_FILE ..."
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$MANIFEST_FILE" "$ts" "db/cmsdb-${ts}.dump" "$db_sha" "volumes/cms-data-${ts}.tar.gz" "$vol_sha" "$pg_ver" "$db_bytes" "$vol_bytes" "$total_bytes" <<'PY'
import json, os, sys, tempfile
manifest_path, ts, db_dump, db_sha, vol_tar, vol_sha, pg_ver, db_b, vol_b, tot_b = sys.argv[1:11]
db_b=int(db_b); vol_b=int(vol_b); tot_b=int(tot_b)
entry={"ts":ts,"db_dump":db_dump,"db_sha256":db_sha,"vol_tar":vol_tar,"vol_sha256":vol_sha,"pg_version":pg_ver,"sizes":{"db_bytes":db_b,"vol_bytes":vol_b,"total_bytes":tot_b}}
if os.path.exists(manifest_path):
    try:
        with open(manifest_path) as f:
            data=json.load(f)
            if not isinstance(data, list):
                data=[data]
    except Exception:
        data=[]
else:
    data=[]
data.append(entry)
os.makedirs(os.path.dirname(manifest_path) or ".", exist_ok=True)
# atomic write: tmp then replace
fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(manifest_path) or ".")
try:
    with os.fdopen(fd, "w") as f:
        json.dump(data,f,indent=2)
        f.write("\n")
    os.replace(tmp_path, manifest_path)
except Exception:
    try: os.unlink(tmp_path)
    except: pass
    raise
PY
  else
    # Fallback: minimal append without python — atomic via mktemp+mv
    if [[ ! -f "$MANIFEST_FILE" ]]; then
      tmp_manifest="$(mktemp "$(dirname -- "$MANIFEST_FILE")/.manifest.XXXXXX")"
      echo "[]" > "$tmp_manifest"
      mv -- "$tmp_manifest" "$MANIFEST_FILE"
      chmod 600 "$MANIFEST_FILE" 2>/dev/null || true
    fi
    # naive — log warning
    log_warn "python3 not found — manifest update is approximate"
  fi
  chmod 600 "$MANIFEST_FILE" 2>/dev/null || true

  # 4) Rotation
  apply_rotation || log_warn "Rotation encountered an error (non-fatal)"

  local db_mb vol_mb
  db_mb="$(awk "BEGIN{printf \"%.2f\", $db_bytes/1048576}")"
  vol_mb="$(awk "BEGIN{printf \"%.2f\", $vol_bytes/1048576}")"
  log_info "Backup complete: db=${db_mb}MB vol=${vol_mb}MB ts=${ts}"
  send_discord "✅ **Backup Successful** — ts \`${ts}\` — DB ${db_mb}MB / Vol ${vol_mb}MB — \`${pg_ver}\`" 65280 "false"
}

# ---------------------------------------------------------------------------
# Cleanup-only mode (legacy compatibility)
# ---------------------------------------------------------------------------
run_cleanup_only() {
  log_info "Running cleanup only"
  apply_rotation
}

# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------
case "${1:-}" in
  --cleanup-only) run_cleanup_only ;;
  --help|-h)
    echo "Usage: $0 [--cleanup-only]"
    echo "Env: BACKUP_DIR, BACKUP_MAX_COUNT, BACKUP_MAX_AGE_DAYS, BACKUP_MAX_SIZE_GB"
    echo "     DISCORD_WEBHOOK_URL (env only), POSTGRES_* from .env.core"
    ;;
  "") run_backup ;;
  *) log_warn "Unknown arg: $1 — running backup anyway"; run_backup ;;
esac