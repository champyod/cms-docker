#!/usr/bin/env bash
# tests/test_backup_metrics.sh — how old the newest backup is, as a fact a monitor can read.
#
# WHY this suite exists: the monitor had a staleness warning that only ever reached its own
# stderr, and the panel could list archives but not say whether any of them was recent. The
# one question an operator actually asks — "is my last backup still recent" — was answerable
# only by reading a log or listing a directory. The fix is a textfile the monitoring stack
# already knows how to scrape (scripts/__lib/common.sh publish_backup_metrics), and this
# suite guards the three ways such a file lies:
#
#   * it says a run succeeded when the run only kept a dump it could not record;
#   * it keeps saying it after a later run failed, so the clock stops moving;
#   * it names a backup whose archive is no longer on disk.
#
# Usage: bash tests/test_backup_metrics.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The harness resolves its own paths, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/backup_harness.sh"
set -u

# The textfile a run publishes, and one series out of it.
metrics_path() { printf '%s/backups/metrics/%s' "$RUN_ROOT" "$BACKUP_METRICS_FILE"; }

metric_value() { # <name> — the sample value, or nothing when the series is absent
  local file
  file="$(metrics_path)"
  [[ -f "$file" ]] || return 0
  awk -v want="$1" '$1 == want { print $2; exit }' "$file" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# 1. A complete run publishes its own timestamp
# ---------------------------------------------------------------------------
printf '== a complete run publishes when it happened ==\n'
new_run_root metrics-success
BEFORE="$(date +%s)"
run_backup
AFTER="$(date +%s)"
expect_exit "the run completes" "0"
check_eq "the textfile is written where the monitoring stack reads it" "yes" \
  "$(test -f "$(metrics_path)" && printf yes || printf no)"
SUCCESS_TS="$(metric_value cms_backup_last_success_timestamp_seconds)"
check_eq "it carries the run's own timestamp" "yes" \
  "$([[ "$SUCCESS_TS" =~ ^[0-9]+$ ]] && (( SUCCESS_TS >= BEFORE && SUCCESS_TS <= AFTER )) && printf yes || printf no)"
check_eq "the backup is not stale" "0" "$(metric_value cms_backup_stale)"
check_eq "the run reports exit 0" "0" "$(metric_value cms_backup_last_run_exit_code)"
check_eq "the run reports success" "1" "$(metric_value cms_backup_last_run_success)"
check_eq "the newest dump on disk is recorded separately" "yes" \
  "$([[ "$(metric_value cms_backup_newest_dump_timestamp_seconds)" =~ ^[1-9][0-9]*$ ]] && printf yes || printf no)"
check_eq "the file says when it was written" "yes" \
  "$([[ "$(metric_value cms_backup_metrics_written_timestamp_seconds)" =~ ^[1-9][0-9]*$ ]] && printf yes || printf no)"

# ---------------------------------------------------------------------------
# 2. A failed run does not reset the clock
# ---------------------------------------------------------------------------
# This is the failure the whole datum exists for: the run that stops working is the one
# nobody sees. The last success must stay where it was, and the failure must be visible in
# the same file.
printf '\n== a failed run leaves the last success where it was ==\n'
sleep 1
run_backup STUB_DUMP=fail
expect_exit "a run without a usable dump is exit 1" "1"
check_eq "the last success did not move" "$SUCCESS_TS" \
  "$(metric_value cms_backup_last_success_timestamp_seconds)"
check_eq "the failed run is recorded as exit 1" "1" "$(metric_value cms_backup_last_run_exit_code)"
check_eq "and as not successful" "0" "$(metric_value cms_backup_last_run_success)"

# ---------------------------------------------------------------------------
# 3. Nothing ever succeeded reads as never, not as fresh
# ---------------------------------------------------------------------------
# Zero is not "the epoch" here: on a box that has never taken a backup the age is the whole
# age of the box and the stale gauge is 1, so an alert on it fires rather than staying quiet.
printf '\n== a box that never took a backup is stale, not fresh ==\n'
new_run_root metrics-never
run_backup STUB_DUMP=fail
expect_exit "the run fails" "1"
check_eq "there is no success timestamp" "0" "$(metric_value cms_backup_last_success_timestamp_seconds)"
check_eq "the box is stale" "1" "$(metric_value cms_backup_stale)"
check_eq "its age is not a small number" "yes" \
  "$([[ "$(metric_value cms_backup_last_success_age_seconds)" =~ ^[0-9]+$ ]] &&
     (( $(metric_value cms_backup_last_success_age_seconds) > 86400 )) && printf yes || printf no)"

# ---------------------------------------------------------------------------
# 4. A success marker without its archive is not a backup
# ---------------------------------------------------------------------------
# The marker outlives the file it describes — rotation, a rehearsal, `down -v` — and a
# timestamp naming an archive nobody can restore is worse than no timestamp at all.
printf '\n== a marker whose archive is gone does not read as a backup ==\n'
new_run_root metrics-orphan
record_backup_success "${RUN_ROOT}/backups" "$(date +%s)"
publish_backup_metrics "${RUN_ROOT}/backups"
check_eq "with no dump on disk there is still no proven backup" "0" \
  "$(metric_value cms_backup_last_success_timestamp_seconds)"
check_eq "and the box is stale" "1" "$(metric_value cms_backup_stale)"
printf 'restored dump\n' > "${RUN_ROOT}/backups/db/cmsdb-20260101-000000.dump"
publish_backup_metrics "${RUN_ROOT}/backups"
check_eq "once the archive is back the recorded success is read" "yes" \
  "$([[ "$(metric_value cms_backup_last_success_timestamp_seconds)" =~ ^[1-9][0-9]*$ ]] && printf yes || printf no)"
check_eq "and the box is no longer stale" "0" "$(metric_value cms_backup_stale)"

# ---------------------------------------------------------------------------
# 5. The threshold is the monitor's own knob
# ---------------------------------------------------------------------------
# One number decides both the log warning and the series, so the same sixty-second-old
# backup has to read fresh under the shipped window and stale under a zero-hour one — proof
# the value comes from the environment and is not a constant compiled into the writer.
printf '== BACKUP_STALE_HOURS drives the series, not a constant ==\n'
new_run_root metrics-threshold
printf 'restored dump\n' > "${RUN_ROOT}/backups/db/cmsdb-20260101-000000.dump"
record_backup_success "${RUN_ROOT}/backups" "$(( $(date +%s) - 60 ))"
publish_backup_metrics "${RUN_ROOT}/backups"
check_eq "a minute-old backup is fresh under the default window" "0" "$(metric_value cms_backup_stale)"
( BACKUP_STALE_HOURS=0; publish_backup_metrics "${RUN_ROOT}/backups" )
check_eq "a zero-hour window makes the same backup stale" "1" "$(metric_value cms_backup_stale)"

# ---------------------------------------------------------------------------
printf '\nPASS: %d  FAIL: %d' "$PASS" "$FAIL"
if (( FAIL > 0 )); then printf '  FAILED\n'; exit 1; fi
printf '  ALL PASS\n'
