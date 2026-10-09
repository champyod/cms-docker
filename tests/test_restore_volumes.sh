#!/usr/bin/env bash
# tests/test_restore_volumes.sh — guard what a restore restores, and what it refuses.
#
# WHY this suite exists: the restore used to accept --with-volumes and put three mounted
# volumes back from an archive. Backups are database-only now, so that whole path is gone
# and the suite holds the two facts that replaced it: a restore restores the database and
# succeeds, and a --with-volumes handed to it is REFUSED rather than ignored.
#
# WHY the refusal is the load-bearing half. A flag that is quietly dropped is read by the
# operator as a restore that also put the volumes back, which is the opposite of what
# happened — the same class of defect as the --force flag that renewed unconditionally
# elsewhere in this codebase. A restore that stops and says why costs a caller one re-read;
# a restore that accepts the flag and restores nothing costs it a submission tree.
#
# WHY a second fixture rather than the backup suites' one: that fixture answers a backup run
# by writing an archive on stdout, which is the whole question a backup suite asks. The
# restore fixture runs the pg_restore/verification sequence and answers the psql count
# queries, so "the database is back" is a fact about the shipped script. No daemon, no
# network, no credentials.
#
# Usage: bash tests/test_restore_volumes.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/backup_assert.sh"
# shellcheck source=/dev/null
source "${ROOT}/scripts/__lib/common.sh"
set +eu +o pipefail
set -u

# The script aborts below DISK_FLOOR_GB free on its own repository root, so the staged
# copy has to sit on a filesystem that clears it — the same reasoning the backup harness
# records, and the same refusal to fall back to the checkout's own filesystem.
scratch_parent() {
  local candidate="${TMPDIR:-/tmp}" required_kib available
  [[ -d "$candidate" && -w "$candidate" ]] || return 1
  available="$(df -Pk "$candidate" 2>/dev/null | awk 'NR==2 {print $4}')"
  required_kib=$(( DISK_FLOOR_GB * KIB_PER_GB ))
  [[ "$available" =~ ^[0-9]+$ ]] && (( available >= required_kib )) || return 1
  printf '%s' "$candidate"
}

if ! SCRATCH_PARENT="$(scratch_parent)"; then
  printf '[FAIL] the restore suite needs %d GB free outside the checkout for its scratch tree\n' \
    "$DISK_FLOOR_GB" >&2
  printf '       set TMPDIR to a writable directory on a filesystem with at least %d GB free\n' \
    "$DISK_FLOOR_GB" >&2
  exit 1
fi

WORK="$(mktemp -d "${SCRATCH_PARENT}/cms-restore-suite.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# The restore derives its repository root from its own path and then sources .env from
# there, so running the worktree copy would read this checkout's real credentials. The
# staged copy is byte-identical and every value it sees is one this suite invented.
STAGE="${WORK}/repo"
mkdir -p "${STAGE}/scripts/__lib" "${WORK}/bin"
cp -- "${ROOT}/scripts/__restore.sh" "${STAGE}/scripts/__restore.sh"
cp -- "${ROOT}/scripts/__lib/common.sh" "${STAGE}/scripts/__lib/common.sh"
cat > "${STAGE}/.env" <<'STUB_ENV'
# Values invented by the restore suite. No host credential is ever read here.
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=stub-owner-password
POSTGRES_DB=cmsdb
STUB_ENV

cp -- "${SCRIPT_DIR}/fixtures/docker-restore" "${WORK}/bin/docker"
chmod 755 "${WORK}/bin/docker"

# The dump every run restores. It only has to exist: the pg_restore that consumes it is
# stubbed, and the suite is about what the shipped script does with it.
DUMPS="${WORK}/dumps"
mkdir -p "$DUMPS"
printf 'stub dump\n' > "${DUMPS}/cmsdb-20260909-120000.dump"
DUMP_FILE="${DUMPS}/cmsdb-20260909-120000.dump"

# An archive that is perfectly good and that no restore may touch. A refusal that quietly
# unpacked it would satisfy "the flag did not break the run" while doing the one thing the
# operator decided against, so its members are ones a real submissions tree would hold.
ARCHIVES="${WORK}/archives"
mkdir -p "${ARCHIVES}"
VOLUME_ARCHIVE="${ARCHIVES}/cms-data-20260909-120000.tar.gz"
VOLUME_TREE="${WORK}/volume-tree"
mkdir -p "${VOLUME_TREE}/cms-data/uploads" \
         "${VOLUME_TREE}/cms-submissions/entries" \
         "${VOLUME_TREE}/cms-ranking"
printf 'contest attachment bytes\n' > "${VOLUME_TREE}/cms-data/uploads/keep.txt"
printf 'entry for contest 2026\n' > "${VOLUME_TREE}/cms-submissions/entries/2026-contest.txt"
printf 'score,rank\n' > "${VOLUME_TREE}/cms-ranking/leaderboard.csv"
tar czf "$VOLUME_ARCHIVE" -C "$VOLUME_TREE" cms-data cms-submissions cms-ranking

check_eq "the archive a refused restore is handed is a real one" "yes" \
  "$( { tar tzf "$VOLUME_ARCHIVE" | grep -q '^cms-submissions/' && printf yes || printf no; } )"

# ---------------------------------------------------------------------------
# One restore
# ---------------------------------------------------------------------------
# run_restore <name> [-- <script arg> ...] — the staged script against the fixture, under
# env -i so an inherited credential cannot reach it. WHY the script's own flags are passed
# after the script path and not through the environment block: env parses anything shaped
# like an option out of its variable assignments, so a --force handed there is read as env's
# flag and the run dies of 127 before the restore starts — an exit that looks like a verdict
# and is not one.
LAST_EXIT=0
RUN_LOG="${WORK}/run.log"
run_restore() {
  local name="$1"
  shift
  local run_root="${WORK}/runs/${name}"
  mkdir -p "${run_root}"
  STUB_LOG="${run_root}/docker.log"
  : > "$STUB_LOG"
  local -a script_args=()
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      while [[ $# -gt 0 ]]; do script_args+=("$1"); shift; done
      break
    fi
    script_args+=("$1")
    shift
  done
  env -i \
    PATH="${WORK}/bin:${PATH}" \
    HOME="$run_root" \
    TMPDIR="${TMPDIR:-/tmp}" \
    LC_ALL=C \
    STUB_LOG="$STUB_LOG" \
    STUB_VOLUME_ROOT="${run_root}/volumes" \
    STUB_FAIL_VOLUME="" \
    bash "${STAGE}/scripts/__restore.sh" "$DUMP_FILE" \
    ${script_args[0]+"${script_args[@]}"} \
    >"$RUN_LOG" 2>&1
  LAST_EXIT=$?
  RUN_ROOT="$run_root"
}

# The pg_restore that put the dump back, read out of the recorded command line rather than
# out of a log line the script chose to print.
restored_the_database() {
  if grep -q 'pg_restore' "$STUB_LOG"; then printf 'yes'; else printf 'no'; fi
}

# Every `docker run` a restore issues, one image per line — the image is the last field of
# the recorded argv. The scratch restore starts exactly one container, the throwaway postgres
# it restores into, and the live restore starts none, so this is what tells "the restore
# brought the database back" apart from "the restore brought something else back too".
helper_container_images() {
  grep '^run ' "$STUB_LOG" | awk '{print $NF}' || true
}

helper_container_count() {
  grep '^run ' "$STUB_LOG" | wc -l | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# 1. Scratch restore: the database comes back and the run succeeds
# ---------------------------------------------------------------------------
printf '== a scratch restore restores the database and succeeds ==\n'
run_restore scratch
check_eq "the scratch restore succeeded" "0" "$LAST_EXIT"
check_eq "it ran pg_restore" "yes" "$(restored_the_database)"
# The one container a scratch restore may start is its own throwaway postgres. Anything else
# would be a helper unpacking an archive, which is what this suite exists to keep out.
check_eq "the only container it starts is the scratch postgres" "postgres:15" \
  "$(helper_container_images | tr '\n' ' ' | sed -E 's/[[:space:]]+$//')"
check_eq "it started exactly one container" "1" "$(helper_container_count)"
check_eq "it reported the submissions count" "yes" "$(grep_yes "$RUN_LOG" 'Submissions count: 7')"
check_eq "it reported the large-object count" "yes" \
  "$(grep_yes "$RUN_LOG" 'pg_largeobject entries: 7')"
check_eq "the summary says the restore finished" "yes" \
  "$(grep_yes "$RUN_LOG" 'CMS restore complete (scratch mode)')"

# ---------------------------------------------------------------------------
# 2. Live restore (--force): the same, into the real database
# ---------------------------------------------------------------------------
printf '\n== a live restore restores the database and succeeds ==\n'
run_restore live -- --force
check_eq "the live restore succeeded" "0" "$LAST_EXIT"
check_eq "it ran pg_restore against the live container" "yes" "$(restored_the_database)"
check_eq "it started no container at all" "0" "$(helper_container_count)"
check_eq "the summary says the restore finished" "yes" \
  "$(grep_yes "$RUN_LOG" 'CMS restore complete (live mode)')"

# ---------------------------------------------------------------------------
# 3. --with-volumes is refused, not ignored
# ---------------------------------------------------------------------------
printf '\n== --with-volumes is refused ==\n'
run_restore refuse-with-volumes -- --with-volumes "$VOLUME_ARCHIVE"
check_eq "the run does not succeed" "0" "$(( LAST_EXIT == 0 ? 1 : 0 ))"
check_eq "the refusal names the flag" "yes" "$(grep_yes "$RUN_LOG" 'with-volumes')"
check_eq "the refusal says backups are database-only" "yes" \
  "$(grep_yes "$RUN_LOG" 'database-only')"
check_eq "the refusal says the data lives in the database" "yes" \
  "$(grep_yes "$RUN_LOG" 'fsobjects\|fsobject.py')"
check_eq "the refusal is on stderr in this repository's FAIL form" "yes" \
  "$(grep_yes "$RUN_LOG" '\[FAIL\]')"
# The whole point of the refusal: the run stopped, so nothing was restored and no archive
# was read. A restore that warned and carried on would leave both of these true.
check_eq "no restore ran at all" "no" "$(restored_the_database)"
check_eq "docker was never asked to do anything" "0" "$(count_lines "$STUB_LOG")"

printf '\n== the =<archive> spelling is refused the same way ==\n'
run_restore refuse-with-volumes-eq "--with-volumes=${VOLUME_ARCHIVE}"
check_eq "the run does not succeed" "0" "$(( LAST_EXIT == 0 ? 1 : 0 ))"
check_eq "the refusal names the flag" "yes" "$(grep_yes "$RUN_LOG" 'with-volumes')"
check_eq "no restore ran at all" "no" "$(restored_the_database)"

printf '\n== the flag is refused in live mode too ==\n'
run_restore refuse-with-volumes-force -- --force --with-volumes "$VOLUME_ARCHIVE"
check_eq "the run does not succeed" "0" "$(( LAST_EXIT == 0 ? 1 : 0 ))"
check_eq "the refusal says backups are database-only" "yes" \
  "$(grep_yes "$RUN_LOG" 'database-only')"
check_eq "no restore ran at all" "no" "$(restored_the_database)"

# ---------------------------------------------------------------------------
# 4. Nothing on disk was touched by a refusal
# ---------------------------------------------------------------------------
printf '\n== a refused flag leaves the volumes alone ==\n'
run_restore refuse-then-check -- --with-volumes "$VOLUME_ARCHIVE"
check_eq "no volume tree was created under the run root" "yes" \
  "$( [[ -e "${RUN_ROOT}/volumes" ]] && printf no || printf yes )"
check_eq "the run log names no volume restore of any kind" "yes" \
  "$(not_grep_yes "$RUN_LOG" 'Volumes restored')"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
