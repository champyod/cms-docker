#!/usr/bin/env bash
# tests/test_restore_volumes.sh — guard where a restore puts each volume's files.
#
# WHY this suite exists: the backup that produced these archives kept one volume and
# left two volumes mounted underneath the data root unreachable, so this is the other
# half of that hole. An archive that carries three volumes restores only if each one's
# files land at its own mount point — the submissions tree inside the data tree, the
# ranking tree beside it — and a restore that quietly unpacks them all into cms-data,
# or that skips one and says nothing, is worse than one that fails loudly.
#
# WHY a second fixture rather than the backup suites' one: that fixture answers a backup
# run by writing an archive on stdout, which is the whole question a backup suite asks.
# tests/fixtures/docker-restore executes the helper script __restore.sh ships, so what
# lands on disk is what the shipped code does rather than what a recorded command line
# claims. No daemon, no network, no credentials.
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

# Dumps and archives the runs restore from. The dump only has to exist: the pg_restore
# that consumes it is stubbed, and the suite is about where the volumes' files land.
DUMPS="${WORK}/dumps"
mkdir -p "$DUMPS"
printf 'stub dump\n' > "${DUMPS}/cmsdb-20260909-120000.dump"
DUMP_FILE="${DUMPS}/cmsdb-20260909-120000.dump"

# ---------------------------------------------------------------------------
# Archives
# ---------------------------------------------------------------------------
# The current shape: every volume under its own prefix, and each carrying a file no
# other volume carries, so "the submissions tree came back" is a fact about one
# member's presence rather than about the archive's weight.
ARCHIVES="${WORK}/archives"
mkdir -p "${ARCHIVES}"
CURRENT_ARCHIVE="${ARCHIVES}/cms-data-20260909-120000.tar.gz"
MULTI_TREE="${WORK}/multi-tree"
mkdir -p "${MULTI_TREE}/cms-data/uploads" \
         "${MULTI_TREE}/cms-submissions/entries" \
         "${MULTI_TREE}/cms-ranking"
printf 'contest attachment bytes\n' > "${MULTI_TREE}/cms-data/uploads/keep.txt"
printf 'entry for contest 2026\n' > "${MULTI_TREE}/cms-submissions/entries/2026-contest.txt"
printf 'score,rank\n' > "${MULTI_TREE}/cms-ranking/leaderboard.csv"
tar czf "$CURRENT_ARCHIVE" -C "$MULTI_TREE" cms-data cms-submissions cms-ranking

# The pre-change shape: cms-data alone, members unprefixed because the archive predates
# prefixes. It has to keep restoring — those sets are still on disk after an upgrade.
LEGACY_ARCHIVE="${ARCHIVES}/cms-data-20250101-000000.tar.gz"
LEGACY_TREE="${WORK}/legacy-tree"
mkdir -p "${LEGACY_TREE}/uploads"
printf 'an older contest attachment\n' > "${LEGACY_TREE}/uploads/keep.txt"
tar czf "$LEGACY_ARCHIVE" -C "$LEGACY_TREE" .

check_eq "the current archive carries all three prefixes" "3" \
  "$(tar tzf "$CURRENT_ARCHIVE" | sed -n 's#^\(cms-[a-z]*\)/.*#\1#p' | sort -u | wc -l | tr -d ' ')"
check_eq "the legacy archive carries no volume prefix" "0" \
  "$(tar tzf "$LEGACY_ARCHIVE" | grep -c -e '^cms-[a-z]*/')"

# ---------------------------------------------------------------------------
# One restore
# ---------------------------------------------------------------------------
# run_restore <name> <archive> [-- <script arg> ...] [VAR=VAL ...] — the staged script
# against the fixture, under env -i so an inherited credential or BACKUP_DIR cannot reach
# it. WHY the script's own flags are passed after the script path and not through the
# environment block: env parses anything shaped like an option out of its variable
# assignments, so a --force handed there is read as env's flag and the run dies of 127
# before the restore starts — an exit that looks like a verdict and is not one.
LAST_EXIT=0
RUN_LOG="${WORK}/run.log"
run_restore() {
  local name="$1" archive="$2"
  shift 2
  local run_root="${WORK}/runs/${name}"
  mkdir -p "${run_root}"
  STUB_LOG="${run_root}/docker.log"
  : > "$STUB_LOG"
  local -a script_args=()
  local -a var_args=()
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      while [[ $# -gt 0 ]]; do script_args+=("$1"); shift; done
      break
    fi
    var_args+=("$1")
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
    ${var_args[0]+"${var_args[@]}"} \
    bash "${STAGE}/scripts/__restore.sh" "$DUMP_FILE" --with-volumes "$archive" \
    ${script_args[0]+"${script_args[@]}"} \
    >"$RUN_LOG" 2>&1
  LAST_EXIT=$?
  RUN_ROOT="$run_root"
  # WHY the scratch volume path is derived here and not held in a variable across the
  # suite: each run gets its own volume root, so a path captured once goes on naming the
  # volume of whichever run happened to come first, and the assertions after it are
  # reading a directory this run never wrote.
  SCRATCH_VOL="${RUN_ROOT}/volumes/cms-restore-scratch-vol"
}

# has_volume_file <volume> <relative path>
has_volume_file() {
  if [[ -f "${RUN_ROOT}/volumes/$1/$2" ]]; then printf 'yes'; else printf 'no'; fi
}

# ---------------------------------------------------------------------------
# 1. Live mode: each volume's files land at its own mount point
# ---------------------------------------------------------------------------
printf '== live restore puts every volume back where it belongs ==\n'
run_restore live "$CURRENT_ARCHIVE" -- --force
check_eq "the live restore succeeded" "0" "$LAST_EXIT"

check_eq "cms-data got its own files" "yes" \
  "$(has_volume_file cms-data uploads/keep.txt)"
check_eq "cms-submissions-contest got its own files" "yes" \
  "$(has_volume_file cms-submissions-contest entries/2026-contest.txt)"
check_eq "cms-ranking-data got its own files" "yes" \
  "$(has_volume_file cms-ranking-data leaderboard.csv)"

# The volume prefix has to come off. Left on, every file lands one level too deep and
# the containers read a tree that has never existed.
check_eq "the volume prefix is stripped from the restored path" "0" \
  "$( { [[ -e "${RUN_ROOT}/volumes/cms-data/cms-data" ]] && printf 1 || printf 0; } )"
check_eq "the submissions tree did not land inside cms-data" "no" \
  "$(has_volume_file cms-data entries/2026-contest.txt)"
check_eq "the ranking tree did not land inside cms-data" "no" \
  "$(has_volume_file cms-data leaderboard.csv)"

# The compose key is not the docker name, and mounting by it restores into a fresh empty
# volume docker creates on the spot — which looks exactly like a successful restore.
check_eq "the restore mounted the submissions volume by its docker name" "yes" \
  "$(grep_yes "$STUB_LOG" 'cms-submissions-contest:/restore')"
check_eq "the restore never mounted the compose key as a volume" "yes" \
  "$(not_grep_yes "$STUB_LOG" '-v cms-submissions:/')"

check_eq "the run reports every volume restored" "yes" \
  "$(grep_yes "$RUN_LOG" 'Volumes restored: 3/3 (0 failed)')"

# ---------------------------------------------------------------------------
# 2. Scratch mode: the same archive, laid out as the containers see it
# ---------------------------------------------------------------------------
# Why this is not the same assertions as live mode: scratch reproduces the live tree
# inside one volume, so a restore that put the submissions files at the data root would
# still look right here and wrong in production. It is the only mode that proves the
# destinations are the in-tree paths the compose file mounts.
printf '\n== scratch restore lays the volumes out as the stack mounts them ==\n'
run_restore scratch "$CURRENT_ARCHIVE"
check_eq "the scratch restore succeeded" "0" "$LAST_EXIT"

check_eq "the data root holds the cms-data files" "yes" \
  "$( { [[ -f "${SCRATCH_VOL}/uploads/keep.txt" ]] && printf yes || printf no; } )"
check_eq "the submissions tree lands inside the data root, as compose mounts it" "yes" \
  "$( { [[ -f "${SCRATCH_VOL}/submissions/entries/2026-contest.txt" ]] && printf yes || printf no; } )"
check_eq "the ranking tree lands inside the data root, as compose mounts it" "yes" \
  "$( { [[ -f "${SCRATCH_VOL}/ranking/leaderboard.csv" ]] && printf yes || printf no; } )"
check_eq "the scratch restore reports every volume restored" "yes" \
  "$(grep_yes "$RUN_LOG" 'Volumes restored: 3/3 (0 failed)')"

# ---------------------------------------------------------------------------
# 3. A pre-change archive still restores
# ---------------------------------------------------------------------------
# The sets on disk after an upgrade were written with one volume and no prefixes.
# Unpacking one of those with the prefixed rule drops its files beside the volume
# mounts instead of inside one — a restore that reports success and restores nothing.
printf '\n== a pre-change archive still restores ==\n'
run_restore legacy "$LEGACY_ARCHIVE"
check_eq "the restore of a pre-change archive succeeded" "0" "$LAST_EXIT"
check_eq "the pre-change files land in the data root, unprefixed" "yes" \
  "$( { [[ -f "${SCRATCH_VOL}/uploads/keep.txt" ]] && printf yes || printf no; } )"
check_eq "the run says the archive predates multi-volume backups" "yes" \
  "$(grep_yes "$RUN_LOG" 'predates multi-volume backups')"
check_eq "the run names the volumes that archive does not hold" "yes" \
  "$(grep_yes "$RUN_LOG" 'carries no submissions or ranking files')"
check_eq "the run reports one volume restored, not three" "yes" \
  "$(grep_yes "$RUN_LOG" 'Volumes restored: 1/3 (0 failed)')"

run_restore legacy-live "$LEGACY_ARCHIVE" -- --force
check_eq "the pre-change archive restores in live mode too" "0" "$LAST_EXIT"
check_eq "its files land in cms-data at the archive root" "yes" \
  "$(has_volume_file cms-data uploads/keep.txt)"
check_eq "no prefix was left on" "0" \
  "$( { [[ -e "${RUN_ROOT}/volumes/cms-data/cms-data" ]] && printf 1 || printf 0; } )"

# ---------------------------------------------------------------------------
# 4. A volume that cannot be restored is named, not skipped
# ---------------------------------------------------------------------------
# The script's own precedent for a step that fails after the database restore is
# log_warn and carry on — dying here would throw away a good database restore over a
# volume. The cost of that policy is that carrying on must never mean quietly, so this
# holds the other half of it: the volume is named and the count is not the clean one.
printf '\n== a volume that cannot be restored is reported ==\n'
run_restore one-fails "$CURRENT_ARCHIVE" STUB_FAIL_VOLUME=cms-submissions-contest -- --force
check_eq "the database restore is not thrown away over one volume" "0" "$LAST_EXIT"
check_eq "the run names the volume it could not restore" "yes" \
  "$(grep_yes "$RUN_LOG" 'Volume restore failed: cms-submissions -> cms-submissions-contest')"
check_eq "the run says that volume's files are not back" "yes" \
  "$(grep_yes "$RUN_LOG" 'its files are not back')"
check_eq "the count reports the shortfall rather than a clean restore" "yes" \
  "$(grep_yes "$RUN_LOG" 'Volumes restored: 2/3 (1 failed)')"
check_eq "the volumes that could be restored were" "yes" \
  "$(has_volume_file cms-data uploads/keep.txt)"
check_eq "the volume that failed holds nothing" "0" \
  "$( { [[ -d "${RUN_ROOT}/volumes/cms-submissions-contest" ]] && printf 1 || printf 0; } )"
check_eq "no clean count is printed alongside the failure" "yes" \
  "$(not_grep_yes "$RUN_LOG" 'Volumes restored: 3/3')"

# A missing archive is the same shape of problem — nothing to put back — and it was
# already a warning rather than a failure before the volumes were split out.
printf '\n== a missing archive is reported, not silently ignored ==\n'
run_restore missing "${ARCHIVES}/no-such-archive.tar.gz"
check_eq "the restore of a missing archive still succeeds" "0" "$LAST_EXIT"
check_eq "the run names the archive it could not find" "yes" \
  "$(grep_yes "$RUN_LOG" 'Volume tar file not found')"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'