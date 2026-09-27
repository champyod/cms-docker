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
check_eq "the helper mounts the named volume read-only" "yes" \
  "$(grep_yes "$STREAM_LOG" -- '-v cms-data:/volume:ro')"
check_eq "the archive is streamed on stdout" "yes" \
  "$(grep_yes "$STREAM_LOG" 'tar czf - -C /volume')"
check_eq "no backup path reached the helper invocation" "yes" \
  "$(not_grep_yes "$STREAM_LOG" "${RUN_ROOT}")"
check_eq "one helper invocation, no needless second attempt" "1" \
  "$(count_lines "$STREAM_LOG")"

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
  "$(grep_yes "$STREAM_LOG" 'alpine:3.19')"
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

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
