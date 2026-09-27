#!/usr/bin/env bash
# tests/test_backup_manifest.sh — guard what a backup run records, and how it says so.
#
# WHY this suite exists: a run that keeps the database dump but cannot archive the volume
# is not a failed backup and not a successful one, and a caller that only sees 0 or 1 cannot
# tell it from either. Worse, the failure mode it replaced returned straight out of the
# volume step, so the manifest, the rotation and the notification were all skipped and the
# run left no trace at all — indistinguishable from a run that never started. The exit
# contract is three values, and the manifest entry is what tells a reader which of them
# happened: 0 complete, 1 nothing usable, 3 the dump is safe and the volume is not.
#
# The second half runs the manifest writer with python3 removed from the PATH. jq, not
# python3, is the tool the chain has to use: the monitor image ships jq and no python3, so a
# manifest that only a python3-first chain can produce is a manifest the container never
# writes. The suite removes the interpreter and checks the file, then reads the result back
# through the real drill reader.
#
# Usage: bash tests/test_backup_manifest.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The harness resolves its own paths, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/backup_harness.sh"
set -u

build_stub_archive

# ---------------------------------------------------------------------------
# 1. A partial run is recorded, and rotation still happens
# ---------------------------------------------------------------------------
# Rotation is the proof that the run did not return at the volume step: the manifest and the
# rotation sit after the archive, so a run that short-circuited on a failed volume would
# leave every superseded set in place.
printf '== partial run records itself and still rotates ==\n'
new_run_root partial-rotation
for old_ts in 20200101-000000 20200102-000000 20200103-000000; do
  printf 'superseded dump\n' > "${RUN_ROOT}/backups/db/cmsdb-${old_ts}.dump"
  printf '%s  cmsdb-%s.dump\n' \
    "0000000000000000000000000000000000000000000000000000000000000000" "$old_ts" \
    > "${RUN_ROOT}/backups/db/cmsdb-${old_ts}.dump.sha256"
done
run_backup STUB_VOLUME=all-fail BACKUP_MAX_COUNT=1 BACKUP_MAX_AGE_DAYS=0 BACKUP_MAX_SIZE_GB=0
expect_exit "a kept dump with no volume archive is exit 3" "3"

check_eq "the dump of the partial run is kept" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-2*.dump')"
check_eq "every superseded set was pruned" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" 'cmsdb-2020010*.dump')"
check_eq "only the newest set is left" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"

PARTIAL_MANIFEST="${RUN_ROOT}/backups/manifest.json"
check_eq "the manifest exists and holds the run" "1" "$(entry_count "$PARTIAL_MANIFEST")"
check_eq "the entry is marked as a volume failure" "failed" \
  "$(entry_field "$PARTIAL_MANIFEST" 0 '.volume_status')"
check_eq "the dump is still described in full" "yes" \
  "$(grep_yes "$PARTIAL_MANIFEST" 'db/cmsdb-')"
check_eq "the reason is named in the run log" "yes" \
  "$(grep_yes "$RUN_LOG" 'Backup partial')"

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
check_eq "the archive step is never reached" "0" \
  "$(count_lines "$STREAM_LOG")"
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
run_backup_on "$QUIET_PATH" STUB_VOLUME=all-fail
expect_exit "a partial run needs no python3" "3"
READER_ON_MARKED="$(drill_reader "${RUN_ROOT}/backups/manifest.json")"

new_run_root quiet
run_backup_on "$QUIET_PATH"
expect_exit "a later complete run needs no python3 either" "0"

QUIET_MANIFEST="${RUN_ROOT}/backups/manifest.json"
check_eq "each run appended an entry instead of replacing the file" "3" \
  "$(entry_count "$QUIET_MANIFEST")"
check_eq "the file is an array of entries" "array" \
  "$(jq -r 'type' "$QUIET_MANIFEST")"

FIRST_TS="$(entry_field "$QUIET_MANIFEST" 0 '.ts')"
check_eq "a complete entry keeps the shape readers already expect" "false" \
  "$(entry_field "$QUIET_MANIFEST" 0 'has("volume_status")')"
check_eq "a complete entry names the archive relative to the root" \
  "volumes/cms-data-${FIRST_TS}.tar.gz" "$(entry_field "$QUIET_MANIFEST" 0 '.vol_tar')"
check_eq "a complete entry carries the archive checksum" "64" \
  "$(printf '%s' "$(entry_field "$QUIET_MANIFEST" 0 '.vol_sha256')" | wc -c | tr -d ' ')"
check_eq "a complete entry keeps vol_bytes a number" "true" \
  "$(entry_field "$QUIET_MANIFEST" 0 '.sizes.vol_bytes | type == "number"')"

MARKED_TS="$(entry_field "$QUIET_MANIFEST" 1 '.ts')"
check_eq "a partial entry is marked" "failed" \
  "$(entry_field "$QUIET_MANIFEST" 1 '.volume_status')"
check_eq "a partial entry reports no archive" "null" \
  "$(entry_field "$QUIET_MANIFEST" 1 '.vol_tar')"
check_eq "a partial entry reports no checksum" "null" \
  "$(entry_field "$QUIET_MANIFEST" 1 '.vol_sha256')"
check_eq "a partial entry zeroes the volume size" "0" \
  "$(entry_field "$QUIET_MANIFEST" 1 '.sizes.vol_bytes')"
check_eq "a partial entry totals to the dump alone" \
  "$(entry_field "$QUIET_MANIFEST" 1 '.sizes.db_bytes')" \
  "$(entry_field "$QUIET_MANIFEST" 1 '.sizes.total_bytes')"
check_eq "a partial entry still describes the dump it kept" \
  "db/cmsdb-${MARKED_TS}.dump" "$(entry_field "$QUIET_MANIFEST" 1 '.db_dump')"
check_eq "the newest complete entry is unmarked too" "false" \
  "$(entry_field "$QUIET_MANIFEST" 2 'has("volume_status")')"

# The drill is the reader that exists in this repository, and it has to work on whatever
# the writer left behind — including a newest entry that is marked.
check_eq "the drill reader reads a marked newest entry" \
  "$(printf '%s\t%s\t%s\t%s' "$MARKED_TS" \
     "$(entry_field "$QUIET_MANIFEST" 1 '.sizes.db_bytes')" "0" \
     "$(entry_field "$QUIET_MANIFEST" 1 '.pg_version')")" \
  "$READER_ON_MARKED"
LAST_TS="$(entry_field "$QUIET_MANIFEST" 2 '.ts')"
check_eq "the drill reader reads the newest entry" \
  "$(printf '%s\t%s\t%s\t%s' "$LAST_TS" \
     "$(entry_field "$QUIET_MANIFEST" 2 '.sizes.db_bytes')" \
     "$(entry_field "$QUIET_MANIFEST" 2 '.sizes.vol_bytes')" \
     "$(entry_field "$QUIET_MANIFEST" 2 '.pg_version')")" \
  "$(drill_reader "$QUIET_MANIFEST")"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
