#!/usr/bin/env bash
# tests/test_backup_manifest.sh — guard what a backup run records, and how it says so.
#
# WHY this suite exists: a run that keeps the database dump but cannot write the manifest
# entry is not a failed backup and not a successful one, and a caller that only sees 0 or 1
# cannot tell it from either. Worse, the failure mode it replaced returned straight out of
# the step that failed, so the manifest, the rotation and the notification were all skipped
# and the run left no trace at all — indistinguishable from a run that never started. The
# exit contract is three values, and the manifest entry is what tells a reader which of them
# happened: 0 complete, 1 nothing usable, 3 the dump is safe but unrecorded.
#
# The entry shape is asserted whole, key by key, rather than field by field. A reader this
# suite does not know about is not the one that has to survive: what matters is that a
# stale volume key — vol_tar, vol_sha256, volume_status, sizes.vol_bytes — makes this
# suite fail, so an entry describing an archive no run produces cannot be added back
# unnoticed.
#
# The second half runs the manifest writer with python3 removed from the PATH. jq, not
# python3, is the tool the chain has to use: the monitor image ships jq and no python3, so a
# manifest that only a python3-first chain can produce is a manifest the container never
# writes. The suite removes the interpreter and checks the file.
#
# Usage: bash tests/test_backup_manifest.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The harness resolves its own paths, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/backup_harness.sh"
set -u

# ---------------------------------------------------------------------------
# 1. A partial run is recorded as absent, and rotation still happens
# ---------------------------------------------------------------------------
# Rotation is the proof that the run did not return at the failing step: the manifest and the
# rotation sit after the dump, so a run that short-circuited would leave every superseded
# set in place.
printf '== a partial run rotates anyway and records nothing ==\n'
new_run_root partial-rotation
for old_ts in 20200101-000000 20200102-000000 20200103-000000; do
  printf 'superseded dump\n' > "${RUN_ROOT}/backups/db/cmsdb-${old_ts}.dump"
  printf '%s  cmsdb-%s.dump\n' \
    "0000000000000000000000000000000000000000000000000000000000000000" "$old_ts" \
    > "${RUN_ROOT}/backups/db/cmsdb-${old_ts}.dump.sha256"
done
run_backup STUB_FAULT_JQ=--argjson BACKUP_MAX_COUNT=1 BACKUP_MAX_AGE_DAYS=0 BACKUP_MAX_SIZE_GB=0
expect_exit "a kept dump the manifest cannot record is exit 3" "3"

check_eq "the dump of the partial run is kept" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-2*.dump')"
check_eq "the checksum of the partial run is kept" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-2*.dump.sha256')"
check_eq "every superseded set was pruned" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-2020010*.dump')"
check_eq "only the newest set is left" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"
check_eq "the manifest is never created for a run that could not record itself" "0" \
  "$(count_matching "${RUN_ROOT}/backups" 'manifest.json')"
check_eq "the reason is named in the run log" "yes" \
  "$(grep_yes "$RUN_LOG" 'manifest unrecorded')"

# ---------------------------------------------------------------------------
# 2. A failed dump is still exit 1, and records nothing
# ---------------------------------------------------------------------------
printf '\n== failed dump keeps its own exit code ==\n'
new_run_root dump-failure
run_backup STUB_DUMP=fail
expect_exit "a run without a usable dump is exit 1, not 3" "1"

check_eq "no manifest is written" "0" \
  "$(count_matching "${RUN_ROOT}/backups" 'manifest.json')"
check_eq "no dump is kept" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"
check_eq "no helper container was launched" "0" "$(count_lines "$STREAM_LOG")"
check_eq "the run names the dump failure" "yes" \
  "$(grep_yes "$RUN_LOG" 'pg_dump as cms_backup failed')"

# ---------------------------------------------------------------------------
# 3. The manifest is written with python3 absent
# ---------------------------------------------------------------------------
printf '\n== manifest written with python3 absent ==\n'
if ! QUIET_PATH="$(build_quiet_path)"; then
  printf '\n== summary ==\n'
  printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
  exit 1
fi
check_eq "the PATH under test resolves no python3" "yes" "$(python3_absent "$QUIET_PATH")"

new_run_root quiet
run_backup_on "$QUIET_PATH"
expect_exit "a complete run needs no python3" "0"

new_run_root quiet
run_cleanup_on "$QUIET_PATH"
expect_exit "a cleanup-only run needs no python3" "0"

new_run_root quiet
run_backup_on "$QUIET_PATH"
expect_exit "a later complete run needs no python3 either" "0"

QUIET_MANIFEST="${RUN_ROOT}/backups/manifest.json"
check_eq "each run appended an entry instead of replacing the file" "2" \
  "$(entry_count "$QUIET_MANIFEST")"
check_eq "the file is an array of entries" "array" \
  "$(jq -r 'type' "$QUIET_MANIFEST")"

FIRST_TS="$(entry_field "$QUIET_MANIFEST" 0 '.ts')"
check_eq "the entry names the run it recorded" "db/cmsdb-${FIRST_TS}.dump" \
  "$(entry_field "$QUIET_MANIFEST" 0 '.db_dump')"
check_eq "the entry carries the dump checksum" "64" \
  "$(printf '%s' "$(entry_field "$QUIET_MANIFEST" 0 '.db_sha256')" | wc -c | tr -d ' ')"
check_eq "db_bytes stays a number" "true" \
  "$(entry_field "$QUIET_MANIFEST" 0 '.sizes.db_bytes | type == "number"')"
check_eq "total_bytes equals the dump, because the dump is all there is" \
  "$(entry_field "$QUIET_MANIFEST" 0 '.sizes.db_bytes')" \
  "$(entry_field "$QUIET_MANIFEST" 0 '.sizes.total_bytes')"

# ---------------------------------------------------------------------------
# 4. The entry shape, asserted whole
# ---------------------------------------------------------------------------
# A key list rather than a per-field test, so a key nobody asked for fails here. A run that
# archives no volume has no archive to point at, no archive to checksum and no partial
# volume status to record, and every one of those keys would be a field describing
# something no reader could ever find on disk.
printf '\n== the entry carries exactly the database-only fields ==\n'
check_eq "a complete entry has no key beyond the database-only set" \
  "db_dump,db_sha256,kind,pg_version,sizes,tables,ts" \
  "$(entry_field "$QUIET_MANIFEST" 0 'keys | join(",")')"
check_eq "the sizes object counts the dump alone" "db_bytes,total_bytes" \
  "$(entry_field "$QUIET_MANIFEST" 0 '.sizes | keys | join(",")')"
check_eq "no stale volume key is left on the newest entry either" \
  "db_dump,db_sha256,kind,pg_version,sizes,tables,ts" \
  "$(entry_field "$QUIET_MANIFEST" 1 'keys | join(",")')"

LAST_TS="$(entry_field "$QUIET_MANIFEST" 1 '.ts')"
check_eq "the newest entry still describes the dump it names" \
  "db/cmsdb-${LAST_TS}.dump" "$(entry_field "$QUIET_MANIFEST" 1 '.db_dump')"

# ---------------------------------------------------------------------------
# 5. A retired set is marked in the manifest, and its entry is kept
# ---------------------------------------------------------------------------
# Rotation deletes the files, but the entry describing them outlives them: a reader cannot
# tell a set the operator still holds from one whose files are gone, and an entry with no
# file behind it reads as a failed run rather than a retired one. The mark is that
# distinction, and it is additive — the record of what was taken, and when it stopped
# existing, is the history a rotation must not throw away. Two retired sets are the
# minimum that shows a loop marking more than one entry and still sparing the newest.
printf '\n== rotation marks each entry it retired, and keeps the entry ==\n'
new_run_root pruned-mark
PRUNED_MANIFEST="${RUN_ROOT}/backups/manifest.json"

# Two sets, each with an entry already on file, so the run rotates entries that predate it
# rather than marking the one it is about to write itself.
for old_ts in 20200101-000000 20200102-000000; do
  printf 'superseded dump\n' > "${RUN_ROOT}/backups/db/cmsdb-${old_ts}.dump"
  printf '%s  cmsdb-%s.dump\n' \
    "0000000000000000000000000000000000000000000000000000000000000000" "$old_ts" \
    > "${RUN_ROOT}/backups/db/cmsdb-${old_ts}.dump.sha256"
done
jq -n --arg first 20200101-000000 --arg second 20200102-000000 '
  def complete($ts):
    {ts: $ts,
     db_dump: ("db/cmsdb-" + $ts + ".dump"),
     db_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
     pg_version: "15.4",
     sizes: {db_bytes: 18, total_bytes: 18},
     kind: "full",
     tables: []};
  [complete($first), complete($second)]
' > "$PRUNED_MANIFEST"

# Only the count rule is left on, so the two retired sets go by the loop and the run keeps
# its own: age and size pruning are off rather than unrepresentative, which would each
# retire a set for a reason the mark never names.
run_backup BACKUP_MAX_COUNT=1 BACKUP_MAX_AGE_DAYS=0 BACKUP_MAX_SIZE_GB=0
expect_exit "a run that rotates its superseded sets is still a complete run" "0"

check_eq "rotation removed the oldest dump" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-20200101-000000.dump')"
check_eq "rotation removed the oldest checksum" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-20200101-000000.dump.sha256')"
check_eq "the set the run kept is the only one left on disk" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-2*.dump')"

check_eq "the entry whose files were removed is marked as retired" "true" \
  "$(entry_field "$PRUNED_MANIFEST" 0 '.pruned')"
check_eq "the second retired entry is marked as well" "true" \
  "$(entry_field "$PRUNED_MANIFEST" 1 '.pruned')"
# WHY the count is 3 and not 1: a mark that shortened the manifest would destroy the very
# history it exists to record, and a reader counting entries is the only way to see that.
check_eq "marking retired an entry kept every entry the file held" "3" \
  "$(entry_count "$PRUNED_MANIFEST")"
check_eq "a mark carries the moment the files stopped existing" "string" \
  "$(entry_field "$PRUNED_MANIFEST" 0 '.pruned_at | type')"
check_eq "the moment is named in UTC" "true" \
  "$(entry_field "$PRUNED_MANIFEST" 0 \
     '.pruned_at | tostring | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")')"
check_eq "the newest entry, whose files are still on disk, is unmarked" "false" \
  "$(entry_field "$PRUNED_MANIFEST" 2 'has("pruned")')"
check_eq "a mark adds no key to the entry it marks" \
  "db_dump,db_sha256,kind,pg_version,pruned,pruned_at,sizes,tables,ts" \
  "$(entry_field "$PRUNED_MANIFEST" 0 'keys | join(",")')"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
