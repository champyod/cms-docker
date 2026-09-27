#!/usr/bin/env bash
# tests/__lib/backup_harness.sh — fixture shared by the backup pipeline suites.
#
# WHY a staged copy of the script instead of the worktree file: __backup.sh derives its
# repository root from its own path and then sources ${REPO_ROOT}/.env, so running the
# worktree copy would read this checkout's real credentials. The suite stages the
# byte-identical file beside a stub .env, so the code under test is the shipped code and
# every value it sees is one the suite invented.
#
# WHY docker is stubbed: the archive contract is which channel the bytes travel (stdout of
# a helper container, not a host bind mount), and a stub records that argv verbatim. No
# daemon, no network, no credentials — and the assertions read the recorded command line
# instead of trusting a code reading.
#
# Sourced by the tests/test_backup_*.sh suites. Not a suite on its own.

set -u

TESTS_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${TESTS_LIB_DIR}/../.." && pwd)"
BASH_BIN="$(command -v bash)"

# The thresholds below are the script's own, read from the library rather than repeated,
# so a change to the disk floor cannot leave a suite guarding a stale number.
# shellcheck source=/dev/null
source "${ROOT}/scripts/__lib/common.sh"
set +eu +o pipefail
set -u

# shellcheck source=/dev/null
source "${TESTS_LIB_DIR}/backup_assert.sh"
set -u

# ---------------------------------------------------------------------------
# Scratch tree
# ---------------------------------------------------------------------------
# The script aborts below DISK_FLOOR_GB free on the backup filesystem, so the scratch has
# to sit on one that clears it. A nearly full /tmp is a normal state on a developer box,
# and the repository's own filesystem is the second candidate.
scratch_parent() {
  local required_kib=$(( DISK_FLOOR_GB * KIB_PER_GB ))
  local candidate available
  for candidate in "${TMPDIR:-/tmp}" "${TESTS_LIB_DIR}"; do
    [[ -d "$candidate" && -w "$candidate" ]] || continue
    available="$(df -Pk "$candidate" 2>/dev/null | awk 'NR==2 {print $4}')"
    if [[ "$available" =~ ^[0-9]+$ ]] && (( available >= required_kib )); then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! SCRATCH_PARENT="$(scratch_parent)"; then
  printf '[FAIL] no writable directory has %d GB free for the scratch tree\n' \
    "$DISK_FLOOR_GB" >&2
  exit 1
fi

WORK="$(mktemp -d "${SCRATCH_PARENT}/cms-backup-suite.XXXXXXXX")"
cleanup_harness() { rm -rf "$WORK"; }
trap cleanup_harness EXIT

# ---------------------------------------------------------------------------
# Staged script, stub credentials, stub docker
# ---------------------------------------------------------------------------
HARNESS_REPO="${WORK}/repo"
HARNESS_SCRIPT="${HARNESS_REPO}/scripts/__backup.sh"
HARNESS_BIN="${WORK}/bin"
HARNESS_QUIET_BIN="${WORK}/jq-only-bin"
STUB_ARCHIVE="${WORK}/helper-archive.tar.gz"
STUB_PAYLOAD_MEMBER="uploads/keep.txt"
STUB_PG_VERSION="15.4"
HARNESS_PATH="${HARNESS_BIN}:${PATH}"

mkdir -p "${HARNESS_REPO}/scripts/__lib" "$HARNESS_BIN" "$HARNESS_QUIET_BIN"
cp -- "${ROOT}/scripts/__backup.sh" "$HARNESS_SCRIPT"
cp -- "${ROOT}/scripts/__lib/common.sh" "${HARNESS_REPO}/scripts/__lib/common.sh"
# The stub is a file rather than a string so what a suite runs against can be read on its
# own, without reading this file to find it.
cp -- "${TESTS_LIB_DIR}/../fixtures/docker" "${HARNESS_BIN}/docker"
chmod 755 "${HARNESS_BIN}/docker"

cat > "${HARNESS_REPO}/.env" <<'STUB_ENV'
# Values invented by the backup suites. The suite never reads a host credential, so a
# run here proves the code path, not anybody's password.
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=stub-owner-password
POSTGRES_BACKUP_PASSWORD=stub-backup-password
POSTGRES_DB=cmsdb
STUB_ENV

build_stub_archive() {
  local payload="${WORK}/payload"
  mkdir -p "${payload}/uploads"
  printf 'contest attachment bytes\n' > "${payload}/${STUB_PAYLOAD_MEMBER}"
  tar czf "$STUB_ARCHIVE" -C "$payload" .
}

# The monitor image ships jq and no python3, so a manifest whose writer needs python3 is a
# manifest the container never produces. The suite removes python3 from the PATH instead
# of reading the code for the word: only the tools the script actually uses are linked in,
# and a missing one is a hard failure rather than a quietly narrower test.
# Prints the directory it built, so a suite holds the path it needs rather than a variable
# this file assigns on its behalf.
build_quiet_path() {
  local -a tools=(awk basename bash cat chmod date df dirname du env grep jq ls mkdir
                  mktemp mv rm sed sha256sum sort stat tar tr xargs gzip)
  local tool resolved
  for tool in "${tools[@]}"; do
    resolved="$(command -v "$tool" 2>/dev/null || true)"
    if [[ -z "$resolved" ]]; then
      printf '[FAIL] %s is not installed — cannot build a python3-free PATH\n' "$tool" >&2
      return 1
    fi
    ln -sf -- "$resolved" "${HARNESS_QUIET_BIN}/${tool}"
  done
  ln -sf -- "${HARNESS_BIN}/docker" "${HARNESS_QUIET_BIN}/docker"
  printf '%s' "${HARNESS_QUIET_BIN}"
}

python3_absent() { # true when the PATH under test resolves no python3
  if env PATH="${1}" bash -c 'command -v python3 >/dev/null 2>&1'; then
    printf 'no'
  else
    printf 'yes'
  fi
}

# ---------------------------------------------------------------------------
# One backup run
# ---------------------------------------------------------------------------
new_run_root() { # <name> — empty backup root for a single run
  RUN_ROOT="${WORK}/runs/${1}"
  mkdir -p "${RUN_ROOT}/backups/db" "${RUN_ROOT}/backups/volumes"
  STUB_LOG="${RUN_ROOT}/docker.log"
  STREAM_LOG="${RUN_ROOT}/docker-stream.log"
  RUN_LOG="${RUN_ROOT}/run.log"
  : > "$STUB_LOG"
  : > "$STREAM_LOG"
}

# run_backup_on <path> [VAR=VAL ...] — the staged script under `env -i`, so an inherited
# credential, a stale BACKUP_DIR or an inherited PATH cannot reach it. The defaults below
# are the shape of an ordinary run; a caller passes its own VAR=VAL after them, and the
# last assignment of a name is the one the child sees, so a scenario is stated where it
# happens instead of through a variable this file has to know the name of.
run_backup_on() {
  local run_path="$1"
  shift
  env -i \
    PATH="$run_path" \
    HOME="$RUN_ROOT" \
    LC_ALL=C \
    BACKUP_DIR="${RUN_ROOT}/backups" \
    BACKUP_MAX_COUNT=50 \
    BACKUP_MAX_AGE_DAYS=10 \
    BACKUP_MAX_SIZE_GB=5 \
    DISCORD_WEBHOOK_URL="" \
    ROLE_ID="" \
    STUB_LOG="$STUB_LOG" \
    STUB_ARCHIVE="$STUB_ARCHIVE" \
    STUB_VOLUME=ok \
    STUB_DUMP=ok \
    STUB_PG_VERSION="$STUB_PG_VERSION" \
    "$@" \
    "$BASH_BIN" "$HARNESS_SCRIPT" "" >"$RUN_LOG" 2>&1
  LAST_EXIT=$?
  # Only the helper invocations, so an assertion about the archive channel is never
  # answered by a backup path that a `docker cp` is entitled to carry.
  grep 'tar czf -' "$STUB_LOG" > "$STREAM_LOG" 2>/dev/null || true
  # 127 is a tool the script shells out to missing from the PATH this run was given, which
  # is a fault in the fixture rather than a contract under test. Carrying on would bury it
  # under assertions about files that were never written.
  if [[ "$LAST_EXIT" == "127" ]]; then
    printf '[FAIL] a tool the script needs is not on PATH %s\n' "$run_path" >&2
    sed 's/^/        /' "$RUN_LOG" >&2
    exit 1
  fi
}

run_backup() { # [VAR=VAL ...] — a run with the host's tools available
  run_backup_on "$HARNESS_PATH" "$@"
}
