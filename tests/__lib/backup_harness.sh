#!/usr/bin/env bash
# tests/__lib/backup_harness.sh — fixture shared by the backup pipeline suites.
#
# WHY a staged copy of the script instead of the worktree file: __backup.sh derives its
# repository root from its own path and then sources ${REPO_ROOT}/.env, so running the
# worktree copy would read this checkout's real credentials. The suite stages the
# byte-identical file beside a stub .env, so the code under test is the shipped code and
# every value it sees is one the suite invented.
#
# WHY docker is stubbed: the contract is which commands a run issues and which files it leaves
# behind, and a stub records that argv verbatim. No daemon, no network, no credentials — and the
# assertions read the recorded command line instead of trusting a code reading.
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
# to sit on one that clears it. A nearly full /tmp is a normal state on a developer box, but
# the checkout's own filesystem is never offered as a substitute: a run killed part-way
# would leave a scratch tree inside the working tree. A caller who needs a different
# filesystem points TMPDIR at it, and a caller who has neither space is told so.
scratch_parent() {
  local candidate="${TMPDIR:-/tmp}"
  local required_kib=$(( DISK_FLOOR_GB * KIB_PER_GB ))
  local available
  [[ -d "$candidate" && -w "$candidate" ]] || return 1
  available="$(df -Pk "$candidate" 2>/dev/null | awk 'NR==2 {print $4}')"
  [[ "$available" =~ ^[0-9]+$ ]] && (( available >= required_kib )) || return 1
  printf '%s' "$candidate"
}

if ! SCRATCH_PARENT="$(scratch_parent)"; then
  printf '[FAIL] the backup suites need %d GB free outside the checkout for the scratch tree\n' \
    "$DISK_FLOOR_GB" >&2
  printf '       set TMPDIR to a writable directory on a filesystem with at least %d GB free\n' \
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
STUB_PG_VERSION="15.4"
HARNESS_PATH="${HARNESS_BIN}:${PATH}"

mkdir -p "${HARNESS_REPO}/scripts/__lib" "$HARNESS_BIN" "$HARNESS_QUIET_BIN"
cp -- "${ROOT}/scripts/__backup.sh" "$HARNESS_SCRIPT"
cp -- "${ROOT}/scripts/__lib/common.sh" "${HARNESS_REPO}/scripts/__lib/common.sh"
# The stubs are files rather than strings so what a suite runs against can be read on its
# own, without reading this file to find it. curl records the alert each run sends; jq, mv and
# rm are the same faulting fixture under three names, because the manifest and rotation
# branches that report a failure are only reachable when one of those tools misbehaves; df
# answers the disk guard with a report a suite chooses.
cp -- "${TESTS_LIB_DIR}/../fixtures/docker" "${HARNESS_BIN}/docker"
cp -- "${TESTS_LIB_DIR}/../fixtures/curl" "${HARNESS_BIN}/curl"
cp -- "${TESTS_LIB_DIR}/../fixtures/df" "${HARNESS_BIN}/df"
for faulted_tool in jq mv rm; do
  cp -- "${TESTS_LIB_DIR}/../fixtures/faulty-tool" "${HARNESS_BIN}/${faulted_tool}"
done
chmod 755 "${HARNESS_BIN}"/*

# WHY the real tools are resolved here rather than looked up by the stubs: the directory
# holding a stub is first on the PATH the run was given, so a stub that ran `jq` would find
# itself again. A stub with nothing to delegate to fails on its own rather than standing in
# for a tool and letting a run pass for the wrong reason.
declare -A HARNESS_REAL_TOOL=()
for staged_tool in jq mv rm df; do
  real_tool_path="$(command -v "$staged_tool" 2>/dev/null || true)"
  if [[ -z "$real_tool_path" ]]; then
    printf '[FAIL] %s is not installed — its staged stub has nothing to delegate to\n' \
      "$staged_tool" >&2
    exit 1
  fi
  HARNESS_REAL_TOOL["${staged_tool^^}"]="$real_tool_path"
done

cat > "${HARNESS_REPO}/.env" <<'STUB_ENV'
# Values invented by the backup suites. The suite never reads a host credential, so a
# run here proves the code path, not anybody's password.
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=stub-owner-password
POSTGRES_BACKUP_PASSWORD=stub-backup-password
POSTGRES_DB=cmsdb
STUB_ENV

# ---------------------------------------------------------------------------
# The alert contract
# ---------------------------------------------------------------------------
# The embed colours __backup.sh sends, named so an assertion reads as the verdict it expects
# instead of as a number. A suite states what a run told Discord, because a run nobody watched
# is judged by that verdict alone.
readonly ALERT_RED=16711680
readonly ALERT_AMBER=16776960
readonly ALERT_GREEN=65280
readonly ALERT_BLUE=15844367

# The webhook the run is handed. The domain is reserved by RFC 2606 and cannot resolve, so
# nothing here reaches Discord even if the recorder were removed, and the last path segment
# reads as a placeholder rather than as a token.
STUB_WEBHOOK_URL="https://discord.invalid/api/webhooks/0/backup-suite-stub"
# The role an amber or red alert pings. A word rather than a snowflake, so a recorded payload
# can never be mistaken for a role id that exists.
STUB_ROLE="backup-suite-role"

alert_colour_name() { # <colour>
  case "$1" in
    "$ALERT_RED") printf 'red' ;;
    "$ALERT_AMBER") printf 'amber' ;;
    "$ALERT_GREEN") printf 'green' ;;
    "$ALERT_BLUE") printf 'blue' ;;
    *) printf 'colour %s' "$1" ;;
  esac
}

# The colours the staged script can send, read from the file rather than repeated, so a
# colour added to the code cannot leave a suite guarding a set that is quietly out of date.
script_alert_colours() {
  grep -oE 'send_discord .*' "$HARNESS_SCRIPT" |
    sed -E 's/.*[[:space:]]([0-9]+)[[:space:]]+"(true|false)".*/\1/' |
    sort -u
}

# The tools a backup run shells out to. Printing them is what lets the python3-free path, the
# path with a tool removed and the ordinary path agree on one list, so a tool a scenario needs
# is a tool every staged PATH carries.
harness_tools() {
  printf '%s\n' awk basename bash cat chmod date df dirname du env grep jq ls mkdir \
    mktemp mv rm sed sha256sum sort stat tar tr xargs gzip
}

# stage_tool <dir> <tool> — one entry of a staged PATH: the harness stub when the tool has
# one, the host's own tool otherwise. Resolved the same way in every staged PATH so a suite
# never has to know which tools happen to be stubbed.
stage_tool() {
  local dir="$1" tool="$2" resolved
  if [[ -f "${HARNESS_BIN}/${tool}" ]]; then
    resolved="${HARNESS_BIN}/${tool}"
  else
    resolved="$(command -v "$tool" 2>/dev/null || true)"
  fi
  if [[ -z "$resolved" ]]; then
    printf '[FAIL] %s is not installed — cannot stage it into a test PATH\n' "$tool" >&2
    return 1
  fi
  ln -sf -- "$resolved" "${dir}/${tool}"
}

# The monitor image ships jq and no python3, so a manifest whose writer needs python3 is a
# manifest the container never produces. The suite removes python3 from the PATH instead
# of reading the code for the word: only the tools the script actually uses are linked in,
# and a missing one is a hard failure rather than a quietly narrower test.
# Prints the directory it built, so a suite holds the path it needs rather than a variable
# this file assigns on its behalf.
build_quiet_path() {
  local -a tools=()
  local tool
  mapfile -t tools < <(harness_tools)
  for tool in "${tools[@]}" docker curl; do
    stage_tool "${HARNESS_QUIET_BIN}" "$tool" || return 1
  done
  printf '%s' "${HARNESS_QUIET_BIN}"
}

# build_path_missing <tool>... — a staged PATH carrying every listed tool except the ones
# named. Removing a tool is how a run reaches the branch that fires without it, and staging
# the rest of the list is what keeps such a run honest: a PATH holding four commands and
# nothing else fails for a reason the scenario did not choose, and the alert under test is
# never reached. The stub goes with the tool, so "docker is missing" is missing rather than
# present and answering.
# Prints the directory it built, in a fresh one per set of names, so a run cannot inherit a
# tool from the run before it.
build_path_missing() {
  local -a tools=()
  local -a names=("$@")
  local dir tool name keep
  mapfile -t tools < <(harness_tools; printf '%s\n' python3)
  dir="${WORK}/bin-missing-${names[*]// /-}"
  mkdir -p "$dir"
  for tool in "${tools[@]}" docker curl; do
    keep=1
    for name in "${names[@]}"; do
      if [[ "$name" == "$tool" ]]; then
        keep=0
      fi
    done
    if (( keep == 1 )); then
      stage_tool "$dir" "$tool" || return 1
    fi
  done
  printf '%s' "$dir"
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
  # WHY only db/ is staged: the script creates every directory it needs, so pre-creating the
  # volumes directory here would make "a run writes no volume archive" true by construction
  # rather than by the run.
  mkdir -p "${RUN_ROOT}/backups/db"
  STUB_LOG="${RUN_ROOT}/docker.log"
  STREAM_LOG="${RUN_ROOT}/docker-stream.log"
  RUN_LOG="${RUN_ROOT}/run.log"
  WEBHOOK_LOG="${RUN_ROOT}/webhook.log"
  : > "$STUB_LOG"
  : > "$STREAM_LOG"
  : > "$WEBHOOK_LOG"
}

# Extra argv words handed to the staged script after its entry argument, so a
# suite can drive a flag the default entry does not carry. Empty by default;
# the ${VAR[@]+...} form keeps `set -u` happy on a bash with no words set.
SCRIPT_EXTRA_ARGS=()

# run_staged_backup <path> <script arg> [VAR=VAL ...] — the one invocation every runner
# shares. It runs under `env -i`, so an inherited credential, a stale BACKUP_DIR or an
# inherited PATH cannot reach the script, and the runner's own PATH comes first so the stubs
# win. The defaults below are the shape of an ordinary run; a caller passes its own VAR=VAL
# after them, and the last assignment of a name is the one the child sees, so a scenario is
# stated where it happens instead of through a variable this file has to know the name of.
run_staged_backup() {
  local run_path="$1" script_arg="$2"
  shift 2
  env -i \
    PATH="$run_path" \
    HOME="$RUN_ROOT" \
    LC_ALL=C \
    BACKUP_DIR="${RUN_ROOT}/backups" \
    BACKUP_MAX_COUNT=50 \
    BACKUP_MAX_AGE_DAYS=10 \
    BACKUP_MAX_SIZE_GB=5 \
    DISCORD_WEBHOOK_URL="$STUB_WEBHOOK_URL" \
    ROLE_ID="$STUB_ROLE" \
    STUB_LOG="$STUB_LOG" \
    STUB_WEBHOOK_LOG="$WEBHOOK_LOG" \
    STUB_DUMP=ok \
    STUB_DF=ok \
    STUB_PG_VERSION="$STUB_PG_VERSION" \
    STUB_FAULT_JQ="" \
    STUB_FAULT_MV="" \
    STUB_FAULT_RM="" \
    STUB_REAL_JQ="${HARNESS_REAL_TOOL[JQ]}" \
    STUB_REAL_MV="${HARNESS_REAL_TOOL[MV]}" \
    STUB_REAL_RM="${HARNESS_REAL_TOOL[RM]}" \
    STUB_REAL_DF="${HARNESS_REAL_TOOL[DF]}" \
    "$@" \
    "$BASH_BIN" "$HARNESS_SCRIPT" "$script_arg" ${SCRIPT_EXTRA_ARGS[@]+"${SCRIPT_EXTRA_ARGS[@]}"} >"$RUN_LOG" 2>&1
  LAST_EXIT=$?
  # Only the helper invocations, so a suite can assert that no run ever asked for an
  # archive. `tar czf -` is how __backup.sh used to stream one onto stdout, so its absence
  # here is what proves the archive channel is gone rather than merely unused.
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

# run_backup_on <path> [VAR=VAL ...] — the staged script with no argument, the default entry.
run_backup_on() { # <path> [VAR=VAL ...]
  local run_path="$1"
  shift
  run_staged_backup "$run_path" "" "$@"
}

# run_cleanup_on <path> [VAR=VAL ...] — the same run in its cleanup-only mode, for the entry
# a suite drives by name rather than through the default.
run_cleanup_on() { # <path> [VAR=VAL ...]
  local run_path="$1"
  shift
  run_staged_backup "$run_path" "--cleanup-only" "$@"
}

run_backup() { # [VAR=VAL ...] — a run with the host's tools available
  run_backup_on "$HARNESS_PATH" "$@"
}

# run_backup_flagged <path> <arg>... — a run whose script argv carries the
# named words after its entry argument, for a flag the default entry does not
# carry. The words apply to the next staged run only.
run_backup_flagged() { # <path> <arg>...
  local run_path="$1"
  shift
  SCRIPT_EXTRA_ARGS=("$@")
  run_backup_on "$run_path"
  SCRIPT_EXTRA_ARGS=()
}
