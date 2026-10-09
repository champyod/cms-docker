#!/usr/bin/env bash
# tests/test_backup_volume_stream.sh — guard that a backup run writes a database-only set.
#
# WHY this suite still exists under its old name: it was the suite that guarded the volume
# archive channel, and the channel it guarded is the thing that had to be removed. Rather
# than delete the coverage, it now holds the archive channel still on the other side — a
# run that asks a helper container for an archive, or writes one under the backup root, has
# reintroduced the behaviour the operator decided against, and fails here.
#
# WHY that is a real check and not a renamed assertion: the recorded docker command line is
# the evidence. `tar czf -` is how __backup.sh used to stream the archive onto stdout, and
# the fixture writes down every invocation, so an archive step in any shape — including one
# named differently from the old one — shows up as a helper invocation rather than as a file
# this suite would have to know the name of.
#
# It runs the real script against a staged copy with a stubbed docker. No daemon, no
# network, no credentials.
#
# Usage: bash tests/test_backup_volume_stream.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The harness resolves its own paths, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/backup_harness.sh"
set -u

# WHY no helper at all may be launched, not merely no archive file: a run that started a
# helper container and then discarded its output would write no archive and still cost a
# container start, a pull and a mount on every backup. The count is the assertion.
no_archive_channel() { # <label>
  check_eq "$1" "0" "$(count_lines "$STREAM_LOG")"
  check_eq "$1 (no helper container was started at all)" "yes" \
    "$(not_grep_yes "$STUB_LOG" '^run ')"
}

# ---------------------------------------------------------------------------
# 1. A complete run writes the database set and nothing else
# ---------------------------------------------------------------------------
printf '== a complete run writes a database-only set ==\n'
new_run_root complete
run_backup
expect_exit "a database-only backup is still a success" "0"

check_eq "one dump is on disk" "1" "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"
DUMP="$(find "${RUN_ROOT}/backups/db" -maxdepth 1 -type f -name '*.dump' | head -1)"
# The run's own timestamp, read out of the filename it wrote rather than out of the alert that
# has to name it — so an alert that stops naming its run fails on the two sides disagreeing,
# not on a substring both happened to share.
RUN_TS="${DUMP##*/cmsdb-}"
RUN_TS="${RUN_TS%.dump}"
check_eq "one checksum sidecar is written next to it" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump.sha256')"
check_eq "the checksum names the dump it belongs to" "$(sha_of "$DUMP")" \
  "$(awk '{print $1}' "${DUMP}.sha256")"

MANIFEST="${RUN_ROOT}/backups/manifest.json"
check_eq "the manifest exists and holds the run" "1" "$(entry_count "$MANIFEST")"
check_eq "the entry describes the dump that was written" \
  "db/$(basename "$DUMP")" "$(entry_field "$MANIFEST" 0 '.db_dump')"

# The volumes directory is not pre-created by the harness, so its absence is the run's
# doing and not the fixture's.
check_eq "a database-only run creates no volumes directory" "yes" \
  "$( [[ -d "${RUN_ROOT}/backups/volumes" ]] && printf no || printf yes )"
check_eq "no archive of any kind sits under the backup root" "0" \
  "$(find "${RUN_ROOT}/backups" -type f -name '*.tar.gz' | wc -l | tr -d '[:space:]')"
no_archive_channel "a complete run asks for no archive"

check_eq "the run announces one green success" "1" \
  "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_GREEN")"
check_eq "the success names the run it belongs to" "yes" \
  "$(has_yes "$(alert_description_of "$WEBHOOK_LOG" "$ALERT_GREEN")" "$RUN_TS")"

# ---------------------------------------------------------------------------
# 2. The archive helper's own failure modes no longer exist
# ---------------------------------------------------------------------------
# STUB_VOLUME is the knob tests/fixtures/docker used for every way an archive could fail:
# a missing image, a fallback that served the run, an every-helper-fails run, and a stream
# that died before its first block. Every one of those ended a run at exit 3. A run that
# still consulted the knob ends at 3 here too, so this scenario passes only when the
# archive channel is gone rather than merely quiet.
printf '\n== the helper-image failure modes no longer reach the run ==\n'
new_run_root helpers-fail
run_backup STUB_VOLUME=all-fail
expect_exit "a run that never archives anything cannot be partial over an archive" "0"

check_eq "the dump is kept" "1" "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"
check_eq "the checksum is written" "1" "$(count_matching "${RUN_ROOT}/backups/db" '*.dump.sha256')"
check_eq "the manifest records the run" "1" \
  "$(entry_count "${RUN_ROOT}/backups/manifest.json")"
check_eq "no archive is written" "0" \
  "$(find "${RUN_ROOT}/backups" -type f -name '*.tar.gz' | wc -l | tr -d '[:space:]')"
no_archive_channel "a run does not fall back to a second helper image either"
check_eq "the run announces a green success, not an archive failure" "1" \
  "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_GREEN")"
check_eq "no alert mentions a volume at all" "yes" \
  "$(not_has_yes "$(alert_description_of "$WEBHOOK_LOG" "$ALERT_GREEN")" 'Vol')"

# ---------------------------------------------------------------------------
# 3. A partial run: the dump is kept and the run is still not whole
# ---------------------------------------------------------------------------
# The only remaining cause of a partial run is a manifest that does not record it, so the
# scenario needs no archive failure at all. A caller reading 0 here would retire a backup
# it has no way to check.
printf '\n== a partial run keeps its dump and still scores 3 ==\n'
new_run_root partial
run_backup STUB_FAULT_JQ=--argjson
expect_exit "a kept dump the manifest cannot record is still exit 3" "3"

check_eq "the dump the partial run kept is on disk" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"
check_eq "the run names the manifest as what failed" "yes" \
  "$(grep_yes "$RUN_LOG" 'could not build the manifest entry')"
no_archive_channel "a partial run does not reach for an archive either"

# ---------------------------------------------------------------------------
# 4. Rotation still deletes every artefact of a timestamp it retires
# ---------------------------------------------------------------------------
printf '\n== rotation still retires a whole set ==\n'
new_run_root rotation
LEGACY_TS=20200101-000000
printf 'superseded dump\n' > "${RUN_ROOT}/backups/db/cmsdb-${LEGACY_TS}.dump"
printf '%s  cmsdb-%s.dump\n' \
  "0000000000000000000000000000000000000000000000000000000000000000" "$LEGACY_TS" \
  > "${RUN_ROOT}/backups/db/cmsdb-${LEGACY_TS}.dump.sha256"

run_backup BACKUP_MAX_COUNT=1 BACKUP_MAX_AGE_DAYS=0 BACKUP_MAX_SIZE_GB=0
expect_exit "a run that pruned a superseded set is still a complete run" "0"

check_eq "rotation removed the retired dump" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" "cmsdb-${LEGACY_TS}.dump")"
check_eq "rotation removed the retired checksum" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" "cmsdb-${LEGACY_TS}.dump.sha256")"
check_eq "no artefact of the retired timestamp survives" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" "*${LEGACY_TS}*")"
check_eq "the run's own dump is the only one left" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"
check_eq "the run's own checksum survived with it" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump.sha256')"
no_archive_channel "a pruning run still asks for no archive"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
