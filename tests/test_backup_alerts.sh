#!/usr/bin/env bash
# tests/test_backup_alerts.sh — guard what a run says about itself.
#
# WHY this suite exists: a backup run's alert is the verdict left behind for the case where
# nobody reads its status, and the monitor that fires the run does not wait for one. Two runs
# told two different stories. A run whose rotation stopped sent an amber "Backup Degraded"
# and then, a line later, a green "Backup Successful" — so the headline an operator reads
# contradicted the warning above it, and the amber was the thing that got scrolled past. A
# run with no jq on the PATH did the same. The exit code stayed 0 for both, deliberately: the
# status contract says what was backed up, the dump was kept, and a caller that reads the
# status saw exactly what it saw before. Only the message was wrong, and the message is what
# this suite holds still.
#
# The suite runs the real script against a staged copy with a stubbed docker, jq, mv and rm,
# and records every POST the run would have made. No daemon, no network, no credentials. Each
# scenario states one verdict and then censuses the rest: one alert of the expected colour,
# silence from the other three. A run that announces a degradation and then a success fails
# the census, which is the whole point.
#
# Usage: bash tests/test_backup_alerts.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The harness resolves its own paths, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/backup_harness.sh"
set -u

build_stub_archive

# ---------------------------------------------------------------------------
# Verdict helpers
# ---------------------------------------------------------------------------
# expect_verdict <label> <colour> <total> <ping|noping> — one alert of the named colour, the
# stated number of alerts in all, silence from every other colour, and the ping contract. The
# silence is half the assertion: a run that reaches the expected alert and then contradicts
# it passes a check that only looks for the expected one.
expect_verdict() { # <label> <colour> <total alerts> <ping|noping>
  local label="$1" colour="$2" total="$3" mention="$4"
  local other expected_mention
  check_eq "${label}: the run sent ${total} alert(s)" "$total" \
    "$(count_lines "$WEBHOOK_LOG")"
  check_eq "${label}: exactly one $(alert_colour_name "$colour") alert" "1" \
    "$(alerts_with_colour "$WEBHOOK_LOG" "$colour")"
  for other in "$ALERT_RED" "$ALERT_AMBER" "$ALERT_GREEN" "$ALERT_BLUE"; do
    if [[ "$other" == "$colour" ]]; then
      continue
    fi
    check_eq "${label}: no $(alert_colour_name "$other") alert" "0" \
      "$(alerts_with_colour "$WEBHOOK_LOG" "$other")"
  done
  if [[ "$mention" == "ping" ]]; then
    expected_mention="<@&${STUB_ROLE}>"
  else
    expected_mention=""
  fi
  check_eq "${label}: the alert pings ${mention}" "$expected_mention" \
    "$(alert_mention_of "$WEBHOOK_LOG" "$colour")"
}

# expect_says <label> <colour> <substring> — what the alert of that colour says has to carry.
# A headline that stops naming the condition it reports is no longer actionable, and a
# reworded one that loses the run it belongs to cannot be matched against a log line.
expect_says() { # <label> <colour> <substring>
  check_eq "$1: the alert says \"$3\"" "yes" \
    "$(has_yes "$(alert_description_of "$WEBHOOK_LOG" "$2")" "$3")"
}

# The ts of the run under test, read from the dump it wrote rather than from the message that
# has to contain it — so an alert that stops naming its own run fails here rather than passing
# on a substring both sides happened to share. The newest dump is the run's own: a run that
# prunes leaves the superseded ones behind, and the alert names the one it just wrote.
run_ts() {
  local dump name
  dump="$(find "${RUN_ROOT}/backups/db" -maxdepth 1 -type f -name 'cmsdb-*.dump' | sort | tail -1)"
  name="${dump##*/cmsdb-}"
  printf '%s' "${name%.dump}"
}

expect_names_run() { # <label> <colour>
  check_eq "$1: the alert names the run it belongs to" "yes" \
    "$(has_yes "$(alert_description_of "$WEBHOOK_LOG" "$2")" "\`$(run_ts)\`")"
}

# Three superseded sets for a run to prune or fail to prune. Written as dumps alone: the
# count rule reads timestamps out of the filenames across both directories, so a dump is
# enough to make a set real.
seed_superseded_sets() {
  local old_ts
  for old_ts in 20200101-000000 20200102-000000 20200103-000000; do
    printf 'superseded dump\n' > "${RUN_ROOT}/backups/db/cmsdb-${old_ts}.dump"
  done
}

# The count rule alone decides the rotation, so the age and size rules are switched off and a
# scenario about pruning cannot be answered by a file that happens to be old enough.
COUNT_ONLY_RULES=(BACKUP_MAX_COUNT=1 BACKUP_MAX_AGE_DAYS=0 BACKUP_MAX_SIZE_GB=0)

if ! NO_JQ_PATH="$(build_path_missing jq)"; then
  printf '\n== summary ==\n'
  printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
  exit 1
fi
if ! NO_DOCKER_PATH="$(build_path_missing docker)"; then
  printf '\n== summary ==\n'
  printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
  exit 1
fi

# ---------------------------------------------------------------------------
# 0. The colours the script can send
# ---------------------------------------------------------------------------
# Read from the staged copy rather than repeated here, so a colour added to the code cannot
# leave this suite guarding a set that is quietly out of date and passing.
printf '== the alerts the script can send ==\n'
check_eq "the script sends only the four colours the suites name" \
  "$(printf '%s\n' "$ALERT_BLUE" "$ALERT_RED" "$ALERT_AMBER" "$ALERT_GREEN" | sort -u)" \
  "$(script_alert_colours)"

# ---------------------------------------------------------------------------
# 1. A complete run ends on green, quietly
# ---------------------------------------------------------------------------
printf '\n== a complete run reports one green ==\n'
new_run_root complete
run_backup
expect_exit "a run that archived both is still a success" "0"
expect_verdict "a complete run" "$ALERT_GREEN" 1 "noping"
expect_says "a complete run" "$ALERT_GREEN" '**Backup Successful**'
expect_says "a complete run" "$ALERT_GREEN" 'DB 0.00MB / Vol 0.00MB'
expect_names_run "a complete run" "$ALERT_GREEN"

# ---------------------------------------------------------------------------
# 2. A rotation that prunes says so, and the run still ends green
# ---------------------------------------------------------------------------
# Two alerts, so the verdict helper does not apply: the count census and the green one do.
printf '\n== a pruning rotation is announced, and the run still ends green ==\n'
new_run_root rotation-applied
seed_superseded_sets
run_backup "${COUNT_ONLY_RULES[@]}"
expect_exit "a run that pruned still backed up" "0"
check_eq "a pruning rotation sends one blue" "1" "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_BLUE")"
check_eq "a pruning rotation still ends on one green" "1" \
  "$(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_GREEN")"
check_eq "no red and no amber for a clean run" "red 0 amber 0" \
  "red $(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_RED") amber $(alerts_with_colour "$WEBHOOK_LOG" "$ALERT_AMBER")"
expect_says "a pruning rotation" "$ALERT_BLUE" 'Backup rotation applied.'
check_eq "a routine rotation pings nobody" "" "$(alert_mention_of "$WEBHOOK_LOG" "$ALERT_BLUE")"
check_eq "a routine success pings nobody" "" "$(alert_mention_of "$WEBHOOK_LOG" "$ALERT_GREEN")"

# ---------------------------------------------------------------------------
# 3. A kept dump with no volume ends on amber, and never green
# ---------------------------------------------------------------------------
printf '\n== a partial run reports one amber ==\n'
new_run_root partial
run_backup STUB_VOLUME=all-fail
expect_exit "a kept dump with no volume is still exit 3" "3"
expect_verdict "a partial run" "$ALERT_AMBER" 1 "ping"
expect_says "a partial run" "$ALERT_AMBER" '**Backup Partial**'
expect_says "a partial run" "$ALERT_AMBER" 'Vol FAILED'
expect_names_run "a partial run" "$ALERT_AMBER"

# ---------------------------------------------------------------------------
# 4. A degraded run ends on amber, and the green is withheld
# ---------------------------------------------------------------------------
# The two halves of the defect. Both runs keep their dump, so both still exit 0 and both used
# to follow the amber with a green that outranked it. The amber is the verdict; the green is
# the thing that has to stop.
printf '\n== a degraded run reports amber and no green ==\n'

new_run_root degraded-no-jq
run_backup_on "$NO_JQ_PATH"
expect_exit "a run whose manifest went unrecorded keeps its exit 0" "0"
expect_verdict "a run with no jq" "$ALERT_AMBER" 1 "ping"
expect_says "a run with no jq" "$ALERT_AMBER" '**Backup Degraded**'
expect_says "a run with no jq" "$ALERT_AMBER" 'jq not found'
expect_says "a run with no jq" "$ALERT_AMBER" 'this run is unrecorded'
expect_names_run "a run with no jq" "$ALERT_AMBER"
check_eq "the run log says it degraded rather than completed" "yes" \
  "$(grep_yes "$RUN_LOG" 'Backup degraded')"

new_run_root degraded-rotation
seed_superseded_sets
run_backup "${COUNT_ONLY_RULES[@]}" STUB_FAULT_RM=cmsdb-20200101-000000.dump
expect_exit "a run whose rotation stopped keeps its exit 0" "0"
expect_verdict "a run whose rotation stopped" "$ALERT_AMBER" 1 "ping"
expect_says "a run whose rotation stopped" "$ALERT_AMBER" '**Backup Degraded**'
expect_says "a run whose rotation stopped" "$ALERT_AMBER" 'rotation aborted'
expect_names_run "a run whose rotation stopped" "$ALERT_AMBER"
check_eq "the stopped rotation is named in the run log" "yes" \
  "$(grep_yes "$RUN_LOG" 'Rotation encountered an error')"
check_eq "no rotation was announced as applied" "yes" \
  "$(not_grep_yes "$RUN_LOG" 'Rotation: removed')"

# ---------------------------------------------------------------------------
# 5. Every failure path announces itself once, loudly, and names its run
# ---------------------------------------------------------------------------
# One red per run, and the other three colours silent. A run that failed this early keeps no
# dump, so there is no ts to check the alert against; the condition is what these assert.
printf '\n== the dump never arrived ==\n'
new_run_root failed-dump
run_backup STUB_DUMP=fail
expect_exit "a run with no usable dump is exit 1" "1"
expect_verdict "a failed dump" "$ALERT_RED" 1 "ping"
expect_says "a failed dump" "$ALERT_RED" '**Backup Failed**'
expect_says "a failed dump" "$ALERT_RED" 'pg_dump error'

printf '\n== the database container is not there ==\n'
new_run_root failed-container
run_backup CMS_DB_CONTAINER=some-other-container
expect_exit "a run with no database container is exit 1" "1"
expect_verdict "a missing database container" "$ALERT_RED" 1 "ping"
expect_says "a missing database container" "$ALERT_RED" 'container cms-database not running'

printf '\n== the backup filesystem cannot be read ==\n'
new_run_root failed-disk-guard
# A path that does not exist is the one way to reach the guard without arranging a nearly full
# filesystem, and the guard treats an unreadable report and a low one the same way.
run_backup BACKUP_DIR="${RUN_ROOT}/backups/never-created" BACKUP_MAX_COUNT=1
expect_exit "a run the disk guard aborted is exit 2" "2"
expect_verdict "an unreadable backup filesystem" "$ALERT_RED" 1 "ping"
expect_says "an unreadable backup filesystem" "$ALERT_RED" 'disk guard aborted'
expect_says "an unreadable backup filesystem" "$ALERT_RED" "under the ${DISK_FLOOR_GB} GB floor"

printf '\n== docker is not on the PATH ==\n'
new_run_root failed-no-docker
run_backup_on "$NO_DOCKER_PATH"
expect_exit "a run with no docker is exit 1" "1"
expect_verdict "a run with no docker" "$ALERT_RED" 1 "ping"
expect_says "a run with no docker" "$ALERT_RED" 'docker not found in PATH'

# ---------------------------------------------------------------------------
# 6. The manifest paths, each with its own reason
# ---------------------------------------------------------------------------
# The dump exists by the time the manifest is written, so these alerts are the only account of
# a run that kept a good backup and recorded nothing. jq cannot be made to fail by arranging
# files, so the fault is keyed on the call itself: --argjson is the entry, --slurpfile the
# merge, and the two .manifest. renames are the seed and the replace.
printf '\n== the manifest entry could not be built ==\n'
new_run_root failed-manifest-entry
run_backup STUB_FAULT_JQ=--argjson
expect_exit "a manifest that could not be written ends the run at 1" "1"
expect_verdict "a manifest entry jq could not build" "$ALERT_RED" 1 "ping"
expect_says "a manifest entry jq could not build" "$ALERT_RED" 'jq could not build the entry'
expect_names_run "a manifest entry jq could not build" "$ALERT_RED"

printf '\n== the manifest entries could not be assembled ==\n'
new_run_root failed-manifest-merge
run_backup STUB_FAULT_JQ=--slurpfile
expect_exit "a manifest that could not be assembled ends the run at 1" "1"
expect_verdict "a manifest jq could not assemble" "$ALERT_RED" 1 "ping"
expect_says "a manifest jq could not assemble" "$ALERT_RED" 'jq could not assemble the entries'
expect_names_run "a manifest jq could not assemble" "$ALERT_RED"

printf '\n== the manifest could not be replaced ==\n'
new_run_root failed-manifest-replace
run_backup STUB_FAULT_MV=.manifest.merged.
expect_exit "a manifest that could not be replaced ends the run at 1" "1"
expect_verdict "a manifest rename that failed" "$ALERT_RED" 1 "ping"
expect_says "a manifest rename that failed" "$ALERT_RED" 'replace failed'
expect_names_run "a manifest rename that failed" "$ALERT_RED"

printf '\n== the manifest could not be created at all ==\n'
# Only reachable without jq, because that is the one branch that seeds the file itself.
new_run_root failed-manifest-seed
run_backup_on "$NO_JQ_PATH" STUB_FAULT_MV=.manifest.
expect_exit "a manifest that could not be created ends the run at 1" "1"
expect_verdict "a manifest that could not be seeded" "$ALERT_RED" 1 "ping"
expect_says "a manifest that could not be seeded" "$ALERT_RED" 'manifest not seeded'
expect_names_run "a manifest that could not be seeded" "$ALERT_RED"

# ---------------------------------------------------------------------------
# 7. Cleanup-only reports its own failure
# ---------------------------------------------------------------------------
# A different entry with a different verdict word, and no dump behind it: prune mode exists to
# reclaim disk, so a rotation that stops is the whole job failing rather than a degraded run.
printf '\n== cleanup-only reports its own failure ==\n'
new_run_root failed-cleanup
seed_superseded_sets
run_cleanup_on "$HARNESS_PATH" "${COUNT_ONLY_RULES[@]}" STUB_FAULT_RM=cmsdb-20200101-000000.dump
expect_exit "a cleanup whose rotation stopped is exit 1" "1"
expect_verdict "a cleanup whose rotation stopped" "$ALERT_RED" 1 "ping"
expect_says "a cleanup whose rotation stopped" "$ALERT_RED" '**Cleanup Failed**'
expect_says "a cleanup whose rotation stopped" "$ALERT_RED" 'rotation aborted'
check_eq "cleanup names no run, because it archived nothing" "yes" \
  "$(not_has_yes "$(alert_description_of "$WEBHOOK_LOG" "$ALERT_RED")" 'ts `')"

# ---------------------------------------------------------------------------
# 8. The census, over every run this suite made
# ---------------------------------------------------------------------------
# No run may send the same severity twice. A path that alerts without ending the run is not
# covered by any single scenario here — each one checks the verdict it expected — and this is
# what catches it, because it reads every recorded POST rather than one colour.
printf '\n== no run sent a severity twice ==\n'
for scenario_root in "${WORK}"/runs/*; do
  [[ -f "${scenario_root}/webhook.log" ]] || continue
  distinct="$(jq -sr '[.[] | .embeds[0].color] | unique | length' "${scenario_root}/webhook.log" 2>/dev/null || printf 'unreadable')"
  check_eq "$(basename "$scenario_root"): every alert had its own severity" "$distinct" \
    "$(count_lines "${scenario_root}/webhook.log")"
done

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
printf 'ALL PASS\n'
