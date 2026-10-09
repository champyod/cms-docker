#!/usr/bin/env bash
# tests/test_backup_volume_stream.sh — guard the volume archive channel and the partial
# signal it raises.
#
# WHY this suite exists: the archive used to be produced by mounting the backup directory
# into the helper container. The docker CLI only carries a bind-mount source to the host
# daemon, which resolves that path on the HOST, so the archive landed in the host tree and
# not in the filesystem the script goes on to read — the file did not exist, and every step
# that consumes it was skipped without a word. Moving only the output channel to stdout
# fixes it: a named volume resolves the same way from either side, so the mount is
# unchanged and the bytes come back to this process.
#
# The stream has a second failure mode that -f cannot see. A stream that dies before its
# first tar block leaves a file that exists and weighs nothing, and a reader that asks only
# "-f" then records a complete archive. An empty volume still tars to a non-zero gzip
# header, so a zero-byte result means the stream died, not that there was nothing to send.
#
# That second half is the case this suite also guards: a helper that succeeds and archives
# an empty tree returns 0 and hands over a real gzip stream — 132 bytes for one empty
# directory here — which weighs something, so "-s" is satisfied and the run would report a
# complete archive for a restore that puts nothing back. Weight is not content, so the run
# lists what it kept.
#
# It runs the real script against a staged copy with a stubbed docker, so the recorded
# command line is the evidence. No daemon, no network, no credentials.
#
# Usage: bash tests/test_backup_volume_stream.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The harness resolves its own paths, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/backup_harness.sh"
set -u

build_stub_archive

# ---------------------------------------------------------------------------
# 1. A complete run: the archive is the helper's stdout, and nothing else
# ---------------------------------------------------------------------------
printf '== complete run, helper image available ==\n'
new_run_root complete
run_backup
expect_exit "a run that archives both leaves is a success" "0"

check_eq "one volume archive is on disk" "1" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"
ARCHIVE="$(find "${RUN_ROOT}/backups/volumes" -maxdepth 1 -type f -name '*.tar.gz' | head -1)"
check_eq "the archive holds the bytes the helper wrote" "$(sha_of "$STUB_ARCHIVE")" \
  "$(sha_of "$ARCHIVE")"
check_eq "those bytes are a real gzip stream" "yes" \
  "$(tar tzf "$ARCHIVE" 2>/dev/null | grep -q "$STUB_PAYLOAD_MEMBER" && printf yes || printf no)"
check_eq "a checksum sidecar is written next to it" "1" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz.sha256')"

# The recorded argv is the whole regression: a host bind mount is the bug, a named volume
# and a stdout stream are the fix, and a backup path on the helper invocation means the old
# shape came back.
# WHY no `--` before the pattern: grep_yes reads <file> <pattern>, so a `--` there is
# the pattern. Every invocation below was matching the literal two dashes in the
# recorded `docker run --rm`, which every argv matches, and none of them could fail.
check_eq "the helper mounts the named volume read-only" "yes" \
  "$(grep_yes "$STREAM_LOG" '-v cms-data:/volume/cms-data:ro')"
check_eq "the archive is streamed on stdout" "yes" \
  "$(grep_yes "$STREAM_LOG" 'tar czf - -C /volume')"
check_eq "no backup path reached the helper invocation" "yes" \
  "$(not_grep_yes "$STREAM_LOG" "${RUN_ROOT}")"
check_eq "one helper invocation, no needless second attempt" "1" \
  "$(count_lines "$STREAM_LOG")"

# ---------------------------------------------------------------------------
# 1b. Every volume mounted under the data root is archived, not just cms-data
# ---------------------------------------------------------------------------
# WHY this is its own block and not an amendment to the argv check above: the argv
# check passes for a run that mounts cms-data alone, which is exactly the shape this
# defect had. Two volumes were mounted under /var/local/lib/cms and no archive the
# script could write reached them, so contest submissions and ranking data existed in
# no backup set at all.
printf '\n== every mounted volume reaches the archive ==\n'

for volume_prefix in cms-data cms-submissions cms-ranking; do
  check_eq "the archive carries ${volume_prefix}'s own files" "yes" \
    "$( { tar tzf "$ARCHIVE" | grep -q "^${volume_prefix}/" && printf yes || printf no; } )"
done

# WHY the submissions volume is named by its docker name and not its compose key:
# docker-compose.yml:824-825 declares `cms-submissions` with `name: cms-submissions-contest`,
# so a -v naming the compose key mounts a fresh empty volume docker creates on the spot.
# A run that misspelt it would archive nothing at all and say so nowhere.
check_eq "the submissions volume is mounted by its docker name" "yes" \
  "$(grep_yes "$STREAM_LOG" '-v cms-submissions-contest:/volume/cms-submissions:ro')"
check_eq "the ranking volume is mounted by its docker name" "yes" \
  "$(grep_yes "$STREAM_LOG" '-v cms-ranking-data:/volume/cms-ranking:ro')"
check_eq "the compose key is never used as a volume name" "yes" \
  "$(not_grep_yes "$STREAM_LOG" '-v cms-submissions:/')"
check_eq "the tar is told to record all three prefixes" "yes" \
  "$(grep_yes "$STREAM_LOG" '-C /volume cms-data cms-submissions cms-ranking')"

for member in "${STUB_VOLUME_MEMBERS[@]}"; do
  check_eq "the archive holds ${member}" "yes" \
    "$( { tar tzf "$ARCHIVE" | grep -q "^${member}$" && printf yes || printf no; } )"
done

# One archive, one name. Every filename list, rotation path and manifest field in the
# script keys on cms-data-${ts}.tar.gz, and the sets already on disk have that name.
check_eq "all three volumes ride in the one archive the set is named for" "1" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"

# ---------------------------------------------------------------------------
# 2. The helper image is unavailable: the fallback still lands real bytes
# ---------------------------------------------------------------------------
printf '\n== helper image unavailable, busybox fallback ==\n'
new_run_root fallback
run_backup STUB_VOLUME=alpine-fails
expect_exit "a run served by the fallback image is a success" "0"

check_eq "one volume archive is on disk" "1" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"
ARCHIVE="$(find "${RUN_ROOT}/backups/volumes" -maxdepth 1 -type f -name '*.tar.gz' | head -1)"
check_eq "the fallback wrote the archive, not a truncated first attempt" \
  "$(sha_of "$STUB_ARCHIVE")" "$(sha_of "$ARCHIVE")"
check_eq "the named image was tried first" "yes" \
  "$(grep_yes "$STREAM_LOG" 'alpine:3.22')"
check_eq "the fallback image is the one that produced the archive" "busybox" \
  "$(archive_image "$STREAM_LOG")"
check_eq "the second attempt is a second invocation, not a retry of the first" "2" \
  "$(count_lines "$STREAM_LOG")"

# ---------------------------------------------------------------------------
# 3. The stream dies before its first block: partial, and nothing kept
# ---------------------------------------------------------------------------
printf '\n== stream dies before the first tar block ==\n'
new_run_root empty
run_backup STUB_VOLUME=empty
expect_exit "a kept dump with no volume is reported as partial" "3"

check_eq "no volume archive survives an empty stream" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"
check_eq "no checksum is written for an archive that never arrived" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz.sha256')"
check_eq "the run names the empty stream as the reason" "yes" \
  "$(grep_yes "$RUN_LOG" 'volume tar empty')"
check_eq "the dump is kept" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"

MANIFEST="${RUN_ROOT}/backups/manifest.json"
check_eq "the manifest exists and holds the run" "1" "$(entry_count "$MANIFEST")"
check_eq "the entry is marked" "failed" "$(entry_field "$MANIFEST" 0 '.volume_status')"
check_eq "vol_tar is null rather than a path to nothing" "null" \
  "$(entry_field "$MANIFEST" 0 '.vol_tar')"
check_eq "vol_sha256 is null" "null" "$(entry_field "$MANIFEST" 0 '.vol_sha256')"
check_eq "vol_bytes stays a number" "0" \
  "$(entry_field "$MANIFEST" 0 '.sizes.vol_bytes')"

# ---------------------------------------------------------------------------
# 4. Every helper fails: the same partial signal, with its own reason
# ---------------------------------------------------------------------------
printf '\n== every helper image fails ==\n'
new_run_root helpers-fail
run_backup STUB_VOLUME=all-fail
expect_exit "a failed volume after a kept dump is still partial" "3"

check_eq "no volume archive is left behind" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"
check_eq "the run names the failed stream as the reason" "yes" \
  "$(grep_yes "$RUN_LOG" 'volume tar failed')"
check_eq "the dump is kept" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"

# ---------------------------------------------------------------------------
# 5. The helper succeeds and archives nothing: real bytes, no file to restore
# ---------------------------------------------------------------------------
# WHY the archive is staged here instead of through a new STUB_VOLUME mode: the fixture
# already streams whatever STUB_ARCHIVE names, so pointing it at an empty tree reaches the
# case without a second knob on a fixture every backup suite shares.
printf '\n== helper archives an empty tree ==\n'
EMPTY_TREE="${WORK}/empty-volume-tree"
EMPTY_ARCHIVE="${WORK}/empty-volume.tar.gz"
mkdir -p "${EMPTY_TREE}/uploads"
tar czf "$EMPTY_ARCHIVE" -C "$EMPTY_TREE" .

# The weight the run has to reject: an archive of nothing is not a zero-byte stream.
check_yes "the empty archive is a real gzip stream, so -s is satisfied" \
  "$(file_bytes "$EMPTY_ARCHIVE" | awk '{print ($1 > 0) ? "yes" : "no"}')"
check_eq "the empty archive carries no member a restore could put back" "0" \
  "$(tar -tzvf "$EMPTY_ARCHIVE" | awk '$1 !~ /^d/' | wc -l | tr -d '[:space:]')"

new_run_root no-files
run_backup "STUB_ARCHIVE=${EMPTY_ARCHIVE}"
expect_exit "an archive that restores nothing is reported as partial" "3"

check_eq "no volume archive is kept for a restore that would yield nothing" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"
check_eq "no checksum is written for an archive that was never usable" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz.sha256')"
check_eq "the run names a file-less archive as the reason" "yes" \
  "$(grep_yes "$RUN_LOG" 'volume tar holds no files')"
check_eq "the dump is kept" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"

MANIFEST="${RUN_ROOT}/backups/manifest.json"
check_eq "the manifest exists and holds the run" "1" "$(entry_count "$MANIFEST")"
check_eq "the entry is marked" "failed" "$(entry_field "$MANIFEST" 0 '.volume_status')"
check_eq "vol_tar is null rather than a path to nothing" "null" \
  "$(entry_field "$MANIFEST" 0 '.vol_tar')"
check_eq "vol_bytes stays a number" "0" "$(entry_field "$MANIFEST" 0 '.sizes.vol_bytes')"

# The verdict is the defect: a run that archived nothing announced a green success.
check_eq "the run announces a partial, not a success" "1" \
  "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_AMBER")"
check_eq "no green success is announced for a run with no volume" "0" \
  "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_GREEN")"

# ---------------------------------------------------------------------------
# 6. One volume came back empty and the others did not: a partial run
# ---------------------------------------------------------------------------
# The defect the multi-volume archive creates if the emptiness test is left where it
# was. A test that stops at the first file member it finds is satisfied by cms-data,
# so a run that lost cms-submissions outright — the whole contest submissions tree —
# reports a complete backup, a green alert and a manifest entry pointing at an archive
# that yields nothing for that volume. Weight is not content, and neither is the first
# volume's content.
printf '\n== one volume empty, another not ==\n'
PARTIAL_TREE="${WORK}/partial-volume-tree"
PARTIAL_ARCHIVE="${WORK}/partial-volume.tar.gz"
mkdir -p "${PARTIAL_TREE}/cms-data/uploads" "${PARTIAL_TREE}/cms-ranking"
printf 'contest attachment bytes\n' > "${PARTIAL_TREE}/cms-data/uploads/keep.txt"
printf 'score,rank\n' > "${PARTIAL_TREE}/cms-ranking/leaderboard.csv"
tar czf "$PARTIAL_ARCHIVE" -C "$PARTIAL_TREE" cms-data cms-ranking

check_eq "the staged archive weighs something, so -s cannot catch this run" "yes" \
  "$(file_bytes "$PARTIAL_ARCHIVE" | awk '{print ($1 > 0) ? "yes" : "no"}')"
check_eq "the staged archive really does carry one volume's files" "yes" \
  "$( { tar tzf "$PARTIAL_ARCHIVE" | grep -q '^cms-data/' && printf yes || printf no; } )"
check_eq "the staged archive really does carry no submissions member" "no" \
  "$( { tar tzf "$PARTIAL_ARCHIVE" | grep -q '^cms-submissions/' && printf yes || printf no; } )"

new_run_root partial-volume
run_backup "STUB_ARCHIVE=${PARTIAL_ARCHIVE}"
expect_exit "a run that lost one volume of three is partial, not a success" "3"

check_eq "no archive is kept for a run that lost a volume" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"
check_eq "the run names the volume it lost" "yes" \
  "$(grep_yes "$RUN_LOG" 'cms-submissions')"
check_eq "the reason says the archive holds nothing for that volume" "yes" \
  "$(grep_yes "$RUN_LOG" 'volume tar holds no files for: cms-submissions')"
check_eq "the dump is kept" "1" \
  "$(count_matching "${RUN_ROOT}/backups/db" '*.dump')"

PARTIAL_MANIFEST="${RUN_ROOT}/backups/manifest.json"
check_eq "the manifest holds the run" "1" "$(entry_count "$PARTIAL_MANIFEST")"
check_eq "the entry is marked" "failed" \
  "$(entry_field "$PARTIAL_MANIFEST" 0 '.volume_status')"
check_eq "vol_tar is null rather than a path to an archive missing a volume" "null" \
  "$(entry_field "$PARTIAL_MANIFEST" 0 '.vol_tar')"

check_eq "the run announces a partial, not a success" "1" \
  "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_AMBER")"
check_eq "no green success is announced for a run that lost a volume" "0" \
  "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_GREEN")"
check_eq "the amber alert names the volume the operator has to go and fetch" "yes" \
  "$(has_yes "$(alert_description_of "$WEBHOOK_LOG" "$ALERT_AMBER")" 'cms-submissions')"

# ---------------------------------------------------------------------------
# 7. A pre-change set is still recognised, and still rotated away
# ---------------------------------------------------------------------------
# The single-archive sets already on disk carry cms-data's files with no prefix at
# all. Rotation keys on the filename, so those sets have to keep being reclaimed or a
# deployment that upgrades this script starts keeping every set it ever took.
printf '\n== a pre-change set is rotated like any other ==\n'
new_run_root legacy-rotation
LEGACY_TS=20200101-000000
printf 'superseded dump\n' > "${RUN_ROOT}/backups/db/cmsdb-${LEGACY_TS}.dump"
printf '%s  cmsdb-%s.dump\n' \
  "0000000000000000000000000000000000000000000000000000000000000000" "$LEGACY_TS" \
  > "${RUN_ROOT}/backups/db/cmsdb-${LEGACY_TS}.dump.sha256"
mkdir -p "${WORK}/legacy-tree/uploads"
printf 'contest attachment bytes\n' > "${WORK}/legacy-tree/uploads/keep.txt"
tar czf "${RUN_ROOT}/backups/volumes/cms-data-${LEGACY_TS}.tar.gz" \
  -C "${WORK}/legacy-tree" .
printf '%s  cms-data-%s.tar.gz\n' \
  "0000000000000000000000000000000000000000000000000000000000000000" "$LEGACY_TS" \
  > "${RUN_ROOT}/backups/volumes/cms-data-${LEGACY_TS}.tar.gz.sha256"

run_backup BACKUP_MAX_COUNT=1 BACKUP_MAX_AGE_DAYS=0 BACKUP_MAX_SIZE_GB=0
expect_exit "a run that pruned a pre-change set is still a complete run" "0"

check_eq "rotation removed the pre-change archive" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" "cms-data-${LEGACY_TS}.tar.gz")"
check_eq "rotation removed the pre-change checksum" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" "cms-data-${LEGACY_TS}.tar.gz.sha256")"
check_eq "the pre-change dump went with it" "0" \
  "$(count_matching "${RUN_ROOT}/backups/db" "cmsdb-${LEGACY_TS}.dump")"
check_eq "the run's own set is the only one left" "1" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" '*.tar.gz')"
check_eq "the run's own set is still named the way every set on disk is named" "1" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" 'cms-data-2*.tar.gz')"
check_eq "no artefact of the retired timestamp survives" "0" \
  "$(count_matching "${RUN_ROOT}/backups/volumes" "*${LEGACY_TS}*")"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
