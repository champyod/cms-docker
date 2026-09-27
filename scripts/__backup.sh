#!/usr/bin/env bash
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

###############################################################################
# CMS Full Backup Script
# - Full logical pg_dump via docker exec (PGPASSWORD in env, not argv)
# - Volume tar via helper container (cms-data:ro mount)
# - manifest.json, rotation across BOTH dirs, disk guard, Discord webhook
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# ---------------------------------------------------------------------------
# Load env.  Do not override already-exported.
# ---------------------------------------------------------------------------
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env" 2>/dev/null || true
  set +a
fi

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
# WHY cms_backup: dedicated BYPASSRLS SELECT-only role for pg_dump; owner cmsuser is NOBYPASSRLS+FORCE RLS so dump as owner fails
POSTGRES_BACKUP_USER_VAL="cms_backup"
POSTGRES_BACKUP_PASSWORD_VAL="${POSTGRES_BACKUP_PASSWORD:-}"

CONTAINER_DB="cms-database"
VOLUME_DATA="cms-data"

# Exit contract — a caller must be able to separate "the database is safe" from
# "nothing was archived" without reading the log:
#   0 = the DB dump and the volume archive are both on disk and readable. A run whose rotation
#       was skipped still reports 0: the run was recorded, so what it costs is retention.
#   1 = no usable backup (the DB step failed, so no dump was kept)
#   3 = partial backup — the dump was kept, but the run is not whole: the volume archive
#       failed, or the manifest does not record this run.
readonly EXIT_PARTIAL_BACKUP=3

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

# WHY one flag rather than a test per path: the contract is that a run which announced a
# degradation must not afterwards announce a success, and a check enumerating the degrading
# paths would be silently wrong the moment one is added without it. The exit code is
# deliberately untouched — the status contract above says what was backed up, and that did
# not change; only the alert contradicted it.
is_degraded=0

send_degraded() {
  # WHY the flag is raised beside the send and not at the call sites: a path that sends its
  # own amber and forgets the flag is a run whose headline contradicts its own warning.
  is_degraded=1
  send_discord "$1" 16776960 "true"
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
# stream_volume_tar <image> — gzipped tar of VOLUME_DATA on stdout
# ---------------------------------------------------------------------------
# WHY stdout instead of `-v BACKUP_VOL_DIR:/backup`: the docker CLI only sends the
# mount request to the host daemon, which resolves a bind-mount source on the
# HOST, so the archive lands in the host's tree and never in this container's
# filesystem — the file then does not exist here and every later step that reads
# it is skipped. VOLUME_DATA is a named volume, which the daemon resolves on its
# own side, so the mount is identical from host or container and only the output
# channel has to move. The caller redirects this function's stdout to the archive
# and reads its exit status, so no pipeline is involved: a failing docker cannot
# be masked by a succeeding writer, with or without pipefail.
stream_volume_tar() {
  local image="$1"
  docker run --rm -v "${VOLUME_DATA}:/volume:ro" "$image" tar czf - -C /volume .
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
      # WHY the status is read instead of left to errexit: the caller tests the rotation in a
      # condition, and errexit is ignored inside a function called that way — so an unchecked
      # removal neither stops the loop nor reaches the caller, and the loop then retries the
      # same set forever. A removal that fails is reported and ends the rotation instead.
      if ! rm -f "$f"; then
        log_warn "Rotation: could not remove $f"
        return 1
      fi
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
      delete_backup_set "$oldest" || return 1
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
        delete_backup_set "$ts" || return 1
        deleted_any=1
      fi
    done
    mapfile -t timestamps < <(list_backup_timestamps)
  fi

  # 3) By total size
  if [[ "$BACKUP_MAX_SIZE_GB" =~ ^[0-9]+$ ]] && (( BACKUP_MAX_SIZE_GB > 0 )); then
    local max_bytes=$(( BACKUP_MAX_SIZE_GB * 1024 * 1024 * 1024 ))
    local total_bytes
    total_bytes="$(du -sb "${BACKUP_DB_DIR}" "${BACKUP_VOL_DIR}" 2>/dev/null | awk '{s+=$1} END{print s+0}')"
    if [[ -z "$total_bytes" || "$total_bytes" == "0" ]]; then
      total_bytes="$(du -cb "${BACKUP_DB_DIR}"/* "${BACKUP_VOL_DIR}"/* 2>/dev/null | tail -1 | awk '{print $1}')"
      total_bytes="${total_bytes:-0}"
    fi
    mapfile -t timestamps < <(list_backup_timestamps)
    while (( total_bytes > max_bytes )); do
      if (( ${#timestamps[@]} <= 1 )); then break; fi
      local oldest="${timestamps[0]}"
      local set_bytes=0
      for f in "${BACKUP_DB_DIR}/cmsdb-${oldest}.dump" "${BACKUP_DB_DIR}/cmsdb-${oldest}.dump.sha256" "${BACKUP_VOL_DIR}/cms-data-${oldest}.tar.gz" "${BACKUP_VOL_DIR}/cms-data-${oldest}.tar.gz.sha256"; do
        if [[ -f "$f" ]]; then
          local sz
          sz="$(file_size_bytes "$f")"
          set_bytes=$(( set_bytes + sz ))
        fi
      done
      delete_backup_set "$oldest" || return 1
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
# Manifest
#
# jq, not python3: the monitor image ships jq (docker/monitor/Dockerfile) and
# the host has it, while it ships no python3 — a python3-first chain left the
# manifest unwritten on every in-container run. jq is also what __create_contests.sh
# and __monitor.sh already read JSON with, so one tool covers the whole script set.
# ---------------------------------------------------------------------------
manifest_entry_json() {
  local ts="$1" db_sha="$2" vol_tar="$3" vol_sha="$4" vol_status="$5"
  local pg_ver="$6" db_bytes="$7" vol_bytes="$8" total_bytes="$9"
  # WHY an empty vol_tar/vol_sha256 becomes null rather than "": a reader has to be
  # able to tell "no volume archive was produced" from "an archive exists at this
  # path", and a size stays a number so size arithmetic never special-cases the run.
  # WHY volume_status is added only when set: a complete run keeps the entry shape it
  # has always had, so every reader that exists today is unaffected by a partial run.
  jq -n \
    --arg ts "$ts" \
    --arg db_sha256 "$db_sha" \
    --arg vol_tar "$vol_tar" \
    --arg vol_sha256 "$vol_sha" \
    --arg vol_status "$vol_status" \
    --arg pg_version "$pg_ver" \
    --argjson db_bytes "$db_bytes" \
    --argjson vol_bytes "$vol_bytes" \
    --argjson total_bytes "$total_bytes" \
    '{
       ts: $ts,
       db_dump: ("db/cmsdb-" + $ts + ".dump"),
       db_sha256: $db_sha256,
       vol_tar: (if $vol_tar == "" then null else $vol_tar end),
       vol_sha256: (if $vol_sha256 == "" then null else $vol_sha256 end),
       pg_version: $pg_version,
       sizes: {db_bytes: $db_bytes, vol_bytes: $vol_bytes, total_bytes: $total_bytes}
     }
     + (if $vol_status == "" then {} else {volume_status: $vol_status} end)'
}

manifest_merge() {
  local prev_file="$1" entry_file="$2" out_file="$3"
  # WHY the shape tests: an existing array is extended, a bare object is wrapped
  # rather than dropped, and an empty array stays empty — so no reader meets a hole.
  jq -n --slurpfile previous "$prev_file" --slurpfile entry "$entry_file" \
    '($previous | length) as $count
     | (if $count == 0 then []
        else ($previous[0] | if type == "array" then . else [.] end)
        end)
     + $entry' > "$out_file"
}

# WHY approximate without jq: the entry shape cannot be assembled from the shell
# alone, so the file is only seeded and the run stays unrecorded.
manifest_seed() {
  local manifest="$1"
  if [[ -f "$manifest" ]]; then
    return 0
  fi
  local seeded
  seeded="$(mktemp "$(dirname -- "$manifest")/.manifest.XXXXXX")"
  printf '[]\n' > "$seeded"
  mv -- "$seeded" "$manifest"
}

# manifest_append <manifest> <ts> <db_sha256> <vol_tar> <vol_sha256>
#               <vol_status> <pg_version> <db_bytes> <vol_bytes> <total_bytes>
manifest_append() {
  local manifest="$1"
  # WHY the ts is read before the shift: every alert below names the run it belongs to, and
  # this argument is the only place that timestamp survives the shift.
  local ts="$2"
  local dir prev entry_file merged
  dir="$(dirname -- "$manifest")"
  mkdir -p "$dir"

  if ! command -v jq >/dev/null 2>&1; then
    # WHY a failed seed is fatal and not approximate: a manifest that cannot be created is a
    # run nobody can read back, which is the one outcome an empty file must not stand in for.
    if ! manifest_seed "$manifest"; then
      log_warn "could not seed the manifest at $manifest"
      send_discord "❌ **Backup Failed** — manifest not seeded at \`${manifest}\` — ts \`${ts}\`" 16711680 "true"
      return 1
    fi
    log_warn "jq not found — manifest update is approximate"
    send_degraded "⚠️ **Backup Degraded** — jq not found: manifest left empty, this run is unrecorded — ts \`${ts}\`"
    # WHY partial and not success: exit 0 is the contract's "full backup", and a run nobody can read
    # back is not one. The dump and the volume archive exist, but nothing records them, so a caller
    # that saw 0 would retire a backup it cannot verify.
    return "$EXIT_PARTIAL_BACKUP"
  fi

  prev="$(mktemp "${dir}/.manifest.prev.XXXXXX")"
  entry_file="$(mktemp "${dir}/.manifest.entry.XXXXXX")"
  merged="$(mktemp "${dir}/.manifest.merged.XXXXXX")"
  shift
  if ! manifest_entry_json "$@" > "$entry_file"; then
    rm -f -- "$prev" "$entry_file" "$merged"
    log_warn "jq could not build the manifest entry"
    send_discord "❌ **Backup Failed** — manifest not updated: jq could not build the entry — ts \`${ts}\`" 16711680 "true"
    return 1
  fi

  # WHY a manifest that does not parse is dropped instead of fatal: an unreadable
  # history must not cost this backup its own entry.
  if ! jq . "$manifest" > "$prev" 2>/dev/null; then
    printf '[]\n' > "$prev"
  fi

  if ! manifest_merge "$prev" "$entry_file" "$merged"; then
    rm -f -- "$prev" "$entry_file" "$merged"
    log_warn "jq could not assemble the manifest"
    send_discord "❌ **Backup Failed** — manifest not updated: jq could not assemble the entries — ts \`${ts}\`" 16711680 "true"
    return 1
  fi

  # atomic write: the merged file is renamed over the manifest in the same directory
  if ! mv -- "$merged" "$manifest"; then
    rm -f -- "$prev" "$entry_file" "$merged"
    log_warn "could not replace the manifest at $manifest"
    send_discord "❌ **Backup Failed** — manifest not updated: replace failed at \`${manifest}\` — ts \`${ts}\`" 16711680 "true"
    return 1
  fi
  rm -f -- "$prev" "$entry_file"
}

# ---------------------------------------------------------------------------
# Main backup
# ---------------------------------------------------------------------------
run_backup() {
  log_info "CMS backup starting — backup root: $BACKUP_ROOT"

  # Disk guard — abort when the backup filesystem has less free than the floor
  # WHY a subshell: require_disk_free_gb dies with its own exit code, and a die in a plain
  # call ends the process before anything can be announced. The subshell keeps that code and
  # that log line, and the caller decides what the operator is told.
  local disk_guard_status=0
  ( require_disk_free_gb "$BACKUP_ROOT" "$DISK_FLOOR_GB" "$DISK_WARN_GB" ) || disk_guard_status=$?
  if (( disk_guard_status != 0 )); then
    send_discord "❌ **Backup Failed** — disk guard aborted at \`${BACKUP_ROOT}\`: free space unreadable or under the ${DISK_FLOOR_GB} GB floor" 16711680 "true"
    exit "$disk_guard_status"
  fi

  mkdir -p -m 700 "$BACKUP_DB_DIR" "$BACKUP_VOL_DIR"
  chmod 700 "$BACKUP_DB_DIR" "$BACKUP_VOL_DIR" 2>/dev/null || true
  chmod 700 "$BACKUP_ROOT" 2>/dev/null || true

  if [[ -z "$POSTGRES_PASSWORD_VAL" ]]; then
    log_warn "POSTGRES_PASSWORD is empty — pg_dump may fail if auth required"
  fi

  if ! command -v docker >/dev/null 2>&1; then
    local msg="docker not found in PATH"
    send_discord "❌ **Backup Failed** — $msg" 16711680 "true"
    log_die "$msg"
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
    if (( ${cleanup_done:-0} == 0 )); then
      docker exec "$CONTAINER_DB" rm -f "${db_tmp:-}" 2>/dev/null || true
    fi
  }
  # WHY ${cleanup_done:-0} / ${db_tmp:-}: the EXIT trap can fire after run_backup returned and its locals are out of scope, so a bare reference would die on set -u and mask the real error.
  trap cleanup_container_tmp EXIT

  # 1) Full logical backup — credentials via docker exec -e PGPASSWORD (never on host argv)
  # WHY cms_backup: BYPASSRLS role can dump under FORCE RLS; owner cmsuser is NOBYPASSRLS+FORCE RLS so dump as owner fails — backups REQUIRE cms_backup
  local pg_dump_user="$POSTGRES_BACKUP_USER_VAL"
  local pg_dump_pass="$POSTGRES_BACKUP_PASSWORD_VAL"
  if [[ -z "$pg_dump_pass" ]]; then
    log_warn "POSTGRES_BACKUP_PASSWORD is empty — backups REQUIRE cms_backup (BYPASSRLS); owner $POSTGRES_USER_VAL cannot dump under FORCE RLS — run './cms config sync' to generate it"
    send_discord "❌ **Backup Failed** — POSTGRES_BACKUP_PASSWORD is not configured; run './cms config sync' to generate it" 16711680 "true"
    return 1
  fi
  log_info "Running pg_dump (Fc) inside $CONTAINER_DB as $pg_dump_user ..."
  if ! docker exec -e PGPASSWORD="$pg_dump_pass" "$CONTAINER_DB" pg_dump -U "$pg_dump_user" -d "$POSTGRES_DB_VAL" -Fc -f "$db_tmp" 2>/tmp/cms-backup-pgdump.log; then
    local err
    err="$(cat /tmp/cms-backup-pgdump.log 2>/dev/null || echo 'pg_dump failed')"
    log_warn "pg_dump as $pg_dump_user failed: $err — backups REQUIRE cms_backup (BYPASSRLS); owner $POSTGRES_USER_VAL is blocked by FORCE RLS; run './cms config sync' to verify POSTGRES_BACKUP_PASSWORD"
    send_discord "❌ **Backup Failed** — pg_dump as $pg_dump_user error: $err" 16711680 "true"
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

  # 2) Volume backup — archive streamed from the helper container (ro mount).
  # WHY no early return here: the dump is already on disk, so a lost volume leaves a
  # usable database backup. Returning at this point would report the run as a total
  # failure and record nothing, which is indistinguishable from a failed dump. The
  # reason is captured instead, and the manifest, the rotation and the notification
  # all run before the run is reported as partial.
  log_info "Archiving volume $VOLUME_DATA ..."
  local vol_image="alpine:3.19"
  # Pull quietly if needed (ignore failure — try busybox fallback)
  docker pull "$vol_image" >/dev/null 2>&1 || true
  local vol_fail_reason=""
  if ! stream_volume_tar "$vol_image" > "$vol_file"; then
    # Fallback to busybox
    if ! stream_volume_tar busybox > "$vol_file"; then
      rm -f "$vol_file"
      vol_fail_reason="volume tar failed"
    fi
  fi

  if [[ -z "$vol_fail_reason" && ! -f "$vol_file" ]]; then
    vol_fail_reason="volume tar missing"
  fi

  # WHY -s and not just -f: a stream that died before the first tar block leaves a
  # file that exists and is 0 bytes, which -f accepts and the manifest then records
  # as a complete archive. An empty volume still tars to a non-zero gzip header.
  if [[ -z "$vol_fail_reason" && ! -s "$vol_file" ]]; then
    rm -f "$vol_file"
    vol_fail_reason="volume tar empty"
  fi

  # WHY the path is empty and the byte count zero when the archive is missing: a
  # reader has to be able to tell "no volume archive was produced" from "an archive
  # exists at this path", and a size stays a number so size arithmetic on an entry
  # never has to special-case this run.
  local vol_sha=""
  local vol_bytes=0
  local vol_status=""
  local vol_tar_rel="volumes/cms-data-${ts}.tar.gz"
  if [[ -n "$vol_fail_reason" ]]; then
    log_warn "Volume archive not produced: $vol_fail_reason"
    vol_status="failed"
    vol_tar_rel=""
  else
    chmod 600 "$vol_file" 2>/dev/null || true
    sha256sum "$vol_file" | awk '{print $1"  " $2}' > "$vol_sha_file"
    chmod 600 "$vol_sha_file" 2>/dev/null || true
    vol_sha="$(awk '{print $1}' "$vol_sha_file")"
    vol_bytes="$(file_size_bytes "$vol_file")"
  fi

  local pg_ver
  pg_ver="$(get_pg_version)"
  local total_bytes=$(( db_bytes + vol_bytes ))

  # 3) manifest.json append
  log_info "Updating manifest $MANIFEST_FILE ..."
  # WHY the status is captured instead of left to errexit: a manifest that cannot be written
  # costs this run its record, not its dump and its archive, and errexit would end the run on
  # the spot — before the rotation, before the summary, and before the run says one word about
  # itself. Judged with the rest of the run's verdict below, it still reaches an exit code.
  local manifest_status=0
  manifest_append "$MANIFEST_FILE" "$ts" "$db_sha" "$vol_tar_rel" "$vol_sha" \
    "$vol_status" "$pg_ver" "$db_bytes" "$vol_bytes" "$total_bytes" || manifest_status=$?
  chmod 600 "$MANIFEST_FILE" 2>/dev/null || true

  # 4) Rotation
  # WHY degraded and not fatal: the dump and the volume archive are already written and recorded by
  # the time rotation runs, so a rotation that aborts costs retention rather than this run's backup.
  # The flag is what makes the difference visible — it routes the run to the degraded verdict below
  # instead of the success alert — and the status stays 0 because the contract's 0 covers the DB and
  # the volume, both of which are present and readable.
  if ! apply_rotation; then
    log_warn "Rotation encountered an error (non-fatal)"
    send_degraded "⚠️ **Backup Degraded** — rotation aborted: superseded sets may accumulate in \`${BACKUP_ROOT}\` — ts \`${ts}\`"
  fi

  local db_mb vol_mb
  db_mb="$(awk "BEGIN{printf \"%.2f\", $db_bytes/1048576}")"
  vol_mb="$(awk "BEGIN{printf \"%.2f\", $vol_bytes/1048576}")"
  if [[ -n "$vol_status" ]]; then
    log_warn "Backup partial: db=${db_mb}MB vol=FAILED (${vol_fail_reason}) ts=${ts}"
    send_discord "⚠️ **Backup Partial** — ts \`${ts}\` — DB ${db_mb}MB OK / Vol FAILED (${vol_fail_reason}) — \`${pg_ver}\`" 16776960 "true"
    return "$EXIT_PARTIAL_BACKUP"
  fi
  # WHY the manifest status is judged here and not left to the alert the function already sent:
  # a run nobody can read back is one a caller cannot verify, and a caller that read 0 would
  # retire a backup it has no way to check. No second alert is sent — the function named the
  # condition — so this only keeps the run from reaching the success alert. Every manifest
  # failure scores 3 and never 1: 1 is reserved for a run that kept no dump, and the dump is
  # on disk by the time this is reached.
  if (( manifest_status != 0 )); then
    log_warn "Backup degraded: db=${db_mb}MB vol=${vol_mb}MB manifest unrecorded ts=${ts}"
    return "$EXIT_PARTIAL_BACKUP"
  fi
  # WHY the success alert is withheld once a run has degraded: the amber alert already went
  # out, and a green headline after it is the last thing a reader sees, so the run announces
  # both outcomes and the reader is left to guess which one the operator meant. The amber
  # alert stands as this run's verdict. The status is unchanged, so a caller that reads the
  # exit code sees exactly what it saw before.
  if (( is_degraded == 1 )); then
    log_warn "Backup degraded: db=${db_mb}MB vol=${vol_mb}MB ts=${ts}"
    return 0
  fi
  log_info "Backup complete: db=${db_mb}MB vol=${vol_mb}MB ts=${ts}"
  send_discord "✅ **Backup Successful** — ts \`${ts}\` — DB ${db_mb}MB / Vol ${vol_mb}MB — \`${pg_ver}\`" 65280 "false"
}

# ---------------------------------------------------------------------------
# Cleanup-only mode (legacy compatibility)
# ---------------------------------------------------------------------------
run_cleanup_only() {
  log_info "Running cleanup only"
  # WHY fatal and not a warning: prune mode exists to reclaim disk, so a rotation that stops
  # is the whole job failing rather than a degraded run with something still usable left.
  if ! apply_rotation; then
    log_warn "Rotation encountered an error (cleanup aborted)"
    send_discord "❌ **Cleanup Failed** — rotation aborted: superseded sets may accumulate in \`${BACKUP_ROOT}\`" 16711680 "true"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------
case "${1:-}" in
  --cleanup-only) run_cleanup_only ;;
  --help|-h)
    echo "Usage: $0 [--cleanup-only]"
    echo "Env: BACKUP_DIR, BACKUP_MAX_COUNT, BACKUP_MAX_AGE_DAYS, BACKUP_MAX_SIZE_GB"
    echo "     DISCORD_WEBHOOK_URL (env only), POSTGRES_* from .env"
    ;;
  "") run_backup ;;
  *) log_warn "Unknown arg: $1 — running backup anyway"; run_backup ;;
esac