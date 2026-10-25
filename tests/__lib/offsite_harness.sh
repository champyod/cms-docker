#!/usr/bin/env bash
# tests/__lib/offsite_harness.sh — fixture shared by the offsite backup suite.
#
# WHY a staged copy of the script instead of the worktree file: __offsite-sync.sh derives
# its repository root from its own path and sources ${REPO_ROOT}/.env, so running the
# worktree copy would read this checkout's real credentials. The suite stages the
# byte-identical file beside a library and a stub .env, so the code under test is the
# shipped code and every value it sees is one the suite invented.
#
# WHY ssh, rsync and gpg are stubs: the contract under test is what leaves the host and how
# the run reports it, and a stub records that verbatim — a real rsync would need a tailnet
# node and a real gpg would need a keyring nobody should have. The one thing that is NOT
# stubbed is the encryption itself: the end-to-end scenario runs the host's own gpg, so
# "the archive still decrypts" is proven against real ciphertext, not against a stub that
# agreed with itself.
#
# Sourced by tests/test_backup_offsite.sh. Not a suite on its own.

set -u

TESTS_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${TESTS_LIB_DIR}/../.." && pwd)"
BASH_BIN="$(command -v bash)"

# shellcheck source=/dev/null
source "${TESTS_LIB_DIR}/backup_assert.sh"
set -u

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cms-offsite-suite.XXXXXXXX")"
cleanup_harness() { rm -rf "$WORK"; }
trap cleanup_harness EXIT

# The staged tree: the script, the library it sources, and an empty .env the script would
# otherwise take from the checkout.
STAGE_REPO="${WORK}/repo"
STAGE_SCRIPT="${STAGE_REPO}/scripts/__offsite-sync.sh"
mkdir -p "${STAGE_REPO}/scripts/__lib" "${STAGE_REPO}/bin" "${WORK}/bin"
cp -- "${ROOT}/scripts/__offsite-sync.sh" "$STAGE_SCRIPT"
cp -- "${ROOT}/scripts/__lib/common.sh" "${STAGE_REPO}/scripts/__lib/common.sh"
: > "${STAGE_REPO}/.env"

REAL_GPG="$(command -v gpg 2>/dev/null || true)"
if [[ -z "$REAL_GPG" ]]; then
  printf '[FAIL] gpg is not installed — the encryption contract cannot be tested without it\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------
# ssh records the remote command it was asked to run. Nothing here reaches a network.
cat > "${WORK}/bin/ssh" <<'STUB_SSH'
#!/usr/bin/env bash
printf 'ssh %s\n' "$*" >> "$STUB_LOG"
exit "${STUB_SSH_STATUS:-0}"
STUB_SSH

# rsync records the transfer and, when it is asked to succeed, copies what it was given
# into STUB_REMOTE — so a suite can inspect the bytes that would have left the host,
# which is the only way to prove from outside that they were ciphertext.
cat > "${WORK}/bin/rsync" <<'STUB_RSYNC'
#!/usr/bin/env bash
printf 'rsync %s\n' "$*" >> "$STUB_LOG"
status="${STUB_RSYNC_STATUS:-0}"
if (( status != 0 )); then
  exit "$status"
fi
for arg in "$@"; do
  case "$arg" in
    /*) src="$arg" ;;
  esac
done
if [[ -n "${src:-}" && -n "${STUB_REMOTE:-}" ]]; then
  cp -- "$src" "$STUB_REMOTE/"
fi
exit 0
STUB_RSYNC

# gpg that records its own /proc/<pid>/cmdline before handing the call to the real one.
# WHY /proc and not "$*": the leak this guards against is a passphrase in the process's
# argv, and /proc/<pid>/cmdline is exactly what any other account on the box can read.
cat > "${WORK}/bin/gpg-argv" <<'STUB_GPG_ARGV'
#!/usr/bin/env bash
if [[ "${1:-}" == "--dump-options" ]]; then
  exec "$STUB_REAL_GPG" "$@"
fi
printf 'gpg-argv %s\n' "$(tr '\0' ' ' < "/proc/$$/cmdline")" >> "$STUB_LOG"
exec "$STUB_REAL_GPG" "$@"
STUB_GPG_ARGV

# gpg that "encrypts" by copying the archive. It answers --dump-options for real (the script
# probes it) and reports no packet list, so a verifier that trusted the tool instead of the
# bytes would happily ship a plaintext archive.
cat > "${WORK}/bin/gpg-copy" <<'STUB_GPG_COPY'
#!/usr/bin/env bash
args=("$@")
i=0
out=""
last=""
while (( i < ${#args[@]} )); do
  case "${args[i]}" in
    --dump-options)
      exec "$STUB_REAL_GPG" "${args[@]}"
      ;;
    --list-packets)
      printf 'stub: this file carries no packets\n'
      exit 2
      ;;
    --output)
      out="${args[i+1]}"
      i=$(( i + 2 ))
      continue
      ;;
    --symmetric|--decrypt|--batch|--yes|--quiet|--passphrase-fd|--pinentry-mode|--no-symkey-cache|--cipher-algo)
      i=$(( i + 1 ))
      continue
      ;;
    --)
      i=$(( i + 1 ))
      continue
      ;;
    *)
      last="${args[i]}"
      i=$(( i + 1 ))
      ;;
  esac
done
if [[ -z "$out" || -z "$last" ]]; then
  exit 1
fi
cp -- "$last" "$out"
STUB_GPG_COPY

chmod 755 "${WORK}"/bin/ssh "${WORK}"/bin/rsync "${WORK}"/bin/gpg-argv "${WORK}"/bin/gpg-copy

# Three staged PATHs, because which gpg a run meets is the scenario:
#   PATH_REAL — real gpg: the encryption under test is the real thing
#   PATH_ARGV — the argv recorder in front of real gpg
#   PATH_COPY — the copier that only pretends to encrypt
build_path() { # <dir> <gpg stub|"">  — prints the directory it built
  local dir="$1" gpg_stub="$2" tool resolved
  mkdir -p "$dir"
  for tool in ssh rsync; do
    ln -sf -- "${WORK}/bin/${tool}" "${dir}/${tool}"
  done
  # The stubs are `#!/usr/bin/env bash`, so the staged PATH has to resolve bash or every
  # stub dies before it records anything and the run fails for the fixture's reason.
  ln -sf -- "$BASH_BIN" "${dir}/bash"
  if [[ -n "$gpg_stub" ]]; then
    ln -sf -- "${WORK}/bin/${gpg_stub}" "${dir}/gpg"
  else
    ln -sf -- "$REAL_GPG" "${dir}/gpg"
  fi
  # The tools the script itself needs from the host, plus the ones the stubs use. Symlinked
  # by absolute path so the staged directory does not shadow them with itself.
  for tool in awk basename cat chmod cmp cp date dirname head ls mkdir mktemp mv od rm \
              sha256sum stat tr; do
    resolved="$(command -v "$tool" 2>/dev/null || true)"
    if [[ -z "$resolved" ]]; then
      printf '[FAIL] %s is not installed — cannot stage it into a test PATH\n' "$tool" >&2
      exit 1
    fi
    ln -sf -- "$resolved" "${dir}/${tool}"
  done
  printf '%s' "$dir"
}

PATH_REAL="$(build_path "${WORK}/path-real" "")"
PATH_ARGV="$(build_path "${WORK}/path-argv" "gpg-argv")"
PATH_COPY="$(build_path "${WORK}/path-copy" "gpg-copy")"

# A key with a marker no archive or path can contain, so finding it in a command line is
# unambiguous, and grepping a log for it can never match something else by accident.
STUB_KEY="suite-passphrase-MARKER-4f1c9a"
STUB_NODE="offsite-node.invalid"
STUB_REMOTE_PATH="/srv/offsite-suite"

# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------
new_offsite_root() { # <name> — an empty backup tree with one archive to ship
  RUN_ROOT="${WORK}/runs/${1}"
  mkdir -p "${RUN_ROOT}/backups/db" "${RUN_ROOT}/remote" "${RUN_ROOT}/tmp" "${RUN_ROOT}/home"
  STUB_LOG="${RUN_ROOT}/stub.log"
  RUN_LOG="${RUN_ROOT}/run.log"
  : > "$STUB_LOG"
  : > "$RUN_LOG"
  # A tarball with the real gzip magic, because the verifier's first check is that the
  # ciphertext no longer starts with it.
  printf 'database dump for the %s scenario\n' "$1" > "${RUN_ROOT}/backups/cmsdb-20260101-000000.dump"
  tar czf "${RUN_ROOT}/backups/cmsdb-20260101-000000.tar.gz" -C "${RUN_ROOT}/backups" \
    cmsdb-20260101-000000.dump
  ARCHIVE="${RUN_ROOT}/backups/cmsdb-20260101-000000.tar.gz"
}

# run_offsite <staged PATH> <mode> [VAR=VAL ...] — one staged run under `env -i`.
# The defaults are an ordinary encrypted run; a caller overrides the one fact it is testing
# and the last assignment of a name wins, so a scenario is stated where it happens.
run_offsite() { # <path> <mode> [VAR=VAL ...]
  local run_path="$1" mode="$2"
  shift 2
  env -i \
    PATH="$run_path" \
    HOME="${RUN_ROOT}/home" \
    TMPDIR="${RUN_ROOT}/tmp" \
    LC_ALL=C \
    BACKUP_DIR="${RUN_ROOT}/backups" \
    OFFSITE_TAILNET_NODE="$STUB_NODE" \
    OFFSITE_REMOTE_PATH="$STUB_REMOTE_PATH" \
    OFFSITE_ENCRYPT_KEY="$STUB_KEY" \
    STUB_LOG="$STUB_LOG" \
    STUB_REMOTE="${RUN_ROOT}/remote" \
    STUB_REAL_GPG="$REAL_GPG" \
    STUB_RSYNC_STATUS=0 \
    STUB_SSH_STATUS=0 \
    "$@" \
    "$BASH_BIN" "$STAGE_SCRIPT" "$mode" >"$RUN_LOG" 2>&1
  LAST_EXIT=$?
}

# ---------------------------------------------------------------------------
# Readers over the run's published facts
# ---------------------------------------------------------------------------
metrics_file() { printf '%s/backups/metrics/cms_backup.prom' "$RUN_ROOT"; }

# metric_value <name> — the sample value of one series in this run's textfile, or nothing.
metric_value() { # <name>
  local name="$1"
  awk -v want="$name" '$1 == want { print $2; exit }' "$(metrics_file)" 2>/dev/null || true
}

offsite_state_file() { printf '%s/backups/metrics/offsite-last-ship.env' "$RUN_ROOT"; }

# state_value <KEY> — one recorded fact about the last shipped copy, or nothing.
state_value() { # <KEY>
  local file
  file="$(offsite_state_file)"
  [[ -f "$file" ]] || return 0
  awk -F= -v k="$1" '$1 == k { print $2; exit }' "$file" 2>/dev/null || true
}

log_has() { grep_yes "$RUN_LOG" "$1"; }
stub_has() { grep_yes "$STUB_LOG" "$1"; }

# The bytes that would have left the host, as the rsync stub copied them.
shipped_files() { count_matching "${RUN_ROOT}/remote" '*'; }
