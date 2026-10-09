#!/usr/bin/env bash
# tests/test_monitor_backup_schedule.sh — one scheduler owns scheduled backups.
#
# WHY this suite exists: two timers were starting backups. The monitor's own timer fired
# cms-backup.sh on BACKUP_INTERVAL_MINS and recorded nothing, while the `scheduler`
# container fired due backup_schedules rows and wrote backup_runs. Both ran, so a backup
# could exist with no row, and a failed nightly run left an operator nothing to check —
# the panel read "no runs" while the box quietly took archives. The scheduler is now the
# sole owner.
#
# Two things have to hold afterwards, and the second is the one that is easy to get
# backwards: removing the timer must not make cms-backup.sh unreachable, because the
# scheduler reaches it by `docker exec cms-monitor bash /usr/local/bin/cms-backup.sh`
# (admin-panel/src/scheduler/tick.ts). So the suite runs the monitor for real and watches
# what it launches, and then checks that the path the scheduler uses is still wired.
#
# The monitor runs with a stepped clock and a loop-bounding sleep stub, so the condition
# that used to fire the timer — an interval elapsed since the stored timestamp — is
# genuinely reached instead of being a race a fast loop would lose. A recorder stub on
# PATH stands in for `bash`, and a self-check proves that recorder works, so "nothing was
# launched" cannot pass by the interception silently failing.
#
# Usage: bash tests/test_monitor_backup_schedule.sh
#        MONITOR_UNDER_TEST_ROOT=<tree> bash tests/test_monitor_backup_schedule.sh
#                                          runs the same assertions against another tree
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="${MONITOR_UNDER_TEST_ROOT:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
MONITOR="${SOURCE_ROOT}/scripts/__monitor.sh"
CYCLE_LIMIT=6
CLOCK_STEP=7200

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

check_absent() { # <label> <needle> <file>
  if grep -qF -- "$2" "$3"; then
    no "$1"
  else
    ok "$1"
  fi
}

check_present() { # <label> <needle> <file>
  if grep -qF -- "$2" "$3"; then
    ok "$1"
  else
    no "$1"
  fi
}

# WHY -E and not a substring: the scheduler's own path to the script stays in the file as
# CMS_BACKUP_SCRIPT, and that reference is legitimate. What must not survive is a line that
# *runs* it.
check_no_backup_invocation() { # <label> <file>
  if grep -nE '^[[:space:]]*(bash|sh|\.)[[:space:]]+[^[:space:]]*cms-backup\.sh' "$2" > /dev/null; then
    no "$1"
  else
    ok "$1"
  fi
}

check_eq() { # <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    ok "$1"
  else
    no "$1 (expected '${2}', got '${3}')"
  fi
}

# WHY a size test rather than a grep: an empty needle matches every file, so the assertion
# would pass against a file the scheduler would then fail to exec.
check_executable_file() { # <label> <path>
  if [ -f "$2" ] && [ -x "$2" ] && [ -s "$2" ]; then
    ok "$1"
  else
    no "$1"
  fi
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cms-monitor-backup-suite.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT
STAGE="${WORK}/stage"
STUB_BIN="${WORK}/bin"
LAUNCH_LOG="${WORK}/cms-backup-launches.log"

# ---------------------------------------------------------------------------
# Staged tree — the monitor resolves .env and its backup root from its own path,
# so it runs against invented values and never this checkout's credentials.
# ---------------------------------------------------------------------------
mkdir -p "${STAGE}/scripts" "${STAGE}/backups/db" "${STUB_BIN}"
cp "$MONITOR" "${STAGE}/scripts/__monitor.sh"
: > "${STAGE}/.env"

# ---------------------------------------------------------------------------
# Stubs. All /bin/sh: a #!/usr/bin/env bash stub would resolve bash through PATH and
# land on the recorder below, which is the trap this file would otherwise walk into.
# ---------------------------------------------------------------------------
cat > "${STUB_BIN}/bash" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$CMS_BACKUP_LAUNCH_LOG"
exit 0
STUB

# WHY a stepped clock: the removed timer compared CURRENT_TIME against a stored timestamp
# and the loop runs in milliseconds, so a real clock never crosses the interval and the old
# branch stays dormant for the whole run. Stepping it is what makes the branch reachable.
cat > "${STUB_BIN}/date" <<'STUB'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in +%s) epoch=1 ;; esac
done
[ "${epoch:-0}" -eq 1 ] || exec /bin/date "$@"
now=$(cat "$CMS_FAKE_CLOCK" 2>/dev/null)
case "$now" in ''|*[!0-9]*) now=0 ;; esac
now=$((now + CMS_FAKE_STEP))
printf '%s\n' "$now" > "$CMS_FAKE_CLOCK"
printf '%s\n' "$now"
STUB

# WHY the parent is signalled rather than the loop ending: the daemon loop is `while true`.
# `sleep 0.5` is the CPU sampler in a command substitution, not the loop, so it is passed
# through and only the loop's own sleep is counted.
cat > "${STUB_BIN}/sleep" <<'STUB'
#!/bin/sh
[ "$1" = "0.5" ] && exec /bin/sleep "$@"
cycles=$(( $(cat "$CMS_FAKE_CYCLES" 2>/dev/null) + 1 ))
printf '%s\n' "$cycles" > "$CMS_FAKE_CYCLES"
if [ "$cycles" -ge "$CMS_CYCLE_LIMIT" ]; then
  cp "$CMS_FAKE_CYCLES" "$CMS_CYCLES_SEEN"
  kill -TERM "$PPID" 2>/dev/null
fi
exit 0
STUB

printf '#!/bin/sh\nexit 0\n' > "${STUB_BIN}/docker"
printf '#!/bin/sh\nprintf 200\n' > "${STUB_BIN}/curl"
printf '#!/bin/sh\nprintf "Mem:  1000 100 100 0 0 0\\n"\n' > "${STUB_BIN}/free"
printf '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/sda1 100 10 90 10%%%% /\\n"\n' \
  > "${STUB_BIN}/df"
chmod +x "${STUB_BIN}"/*

# Runs the staged monitor as a daemon for CYCLE_LIMIT cycles and records every `bash`
# launch the recorder stub saw. BACKUP_INTERVAL_MINS is deliberately 1: that is the value
# at which the removed timer fired within one stepped cycle.
# WHY the run is a background job waited on rather than a foreground command: the loop is
# stopped by a signal, and a foreground child killed by a signal has its death announced on
# the suite's own stderr. Waiting on it keeps that out of the report.
run_monitor() {
  local monitor_pid
  : > "$LAUNCH_LOG"
  rm -f "${WORK}/cycles.seen"
  printf '%s\n' "$(/bin/date +%s)" > "${WORK}/clock"
  printf '0\n' > "${WORK}/cycles"
  env PATH="${STUB_BIN}:${PATH}" \
    CMS_BACKUP_LAUNCH_LOG="$LAUNCH_LOG" \
    CMS_FAKE_CLOCK="${WORK}/clock" CMS_FAKE_STEP="$CLOCK_STEP" \
    CMS_FAKE_CYCLES="${WORK}/cycles" CMS_CYCLES_SEEN="${WORK}/cycles.seen" \
    CMS_CYCLE_LIMIT="$CYCLE_LIMIT" \
    BACKUP_DIR="${STAGE}/backups" BACKUP_INTERVAL_MINS=1 BACKUP_STALE_HOURS=26 \
    MONITOR_INTERVAL=1 DISK_PATH=/ \
    DISCORD_WEBHOOK_URL="https://example.invalid/webhook" DISCORD_ROLE_ID=1 \
    /bin/bash "${STAGE}/scripts/__monitor.sh" -d -i 1 \
    > "${WORK}/monitor.out" 2>&1 &
  monitor_pid=$!
  wait "$monitor_pid"
  return 0
}

cycles_run() { cat "${WORK}/cycles.seen" 2>/dev/null || printf '0'; }
launches() { cat "$LAUNCH_LOG" 2>/dev/null; }
monitor_says_stale() { grep -q 'cms-scheduler container from the' "${WORK}/monitor.out"; }

place_archive() { # <name> <age in hours, 0 = now>
  local name="$1" hours="$2"
  printf 'stub\n' > "${STAGE}/backups/db/${name}"
  touch -d "@$(( $(/bin/date +%s) - hours * 3600 ))" "${STAGE}/backups/db/${name}"
}

clear_archives() { rm -f "${STAGE}"/backups/db/cmsdb-*.dump; }

printf '== the monitor keeps no backup timer of its own ==\n'
check_absent "the monitor defines no backup interval knob" 'BACKUP_INTERVAL_MINS' "$MONITOR"
check_absent "the monitor keeps no last-backup timestamp" 'LAST_BACKUP_TIME' "$MONITOR"
check_absent "the monitor computes no interval in seconds" 'BACKUP_INTERVAL_SECS' "$MONITOR"
check_no_backup_invocation "no line in the monitor runs cms-backup.sh" "$MONITOR"

printf '== the harness can actually see a backup being launched ==\n'
printf '#!/bin/bash\nbash /usr/local/bin/cms-backup.sh\n' > "${WORK}/probe.sh"
env PATH="${STUB_BIN}:${PATH}" CMS_BACKUP_LAUNCH_LOG="${WORK}/probe.log" \
  /bin/bash "${WORK}/probe.sh"
check_eq "the launch recorder catches a bash launch" "1" \
  "$(wc -l < "${WORK}/probe.log" 2>/dev/null | tr -d ' ')"

printf '== running the monitor launches nothing ==\n'
clear_archives
run_monitor
check_eq "the staged monitor completed its cycles" "$CYCLE_LIMIT" "$(cycles_run)"
check_eq "a past interval never launches cms-backup.sh" "" "$(launches)"

printf '== the scheduler still reaches the backup script ==\n'
check_executable_file "scripts/__backup.sh is present, non-empty and executable" \
  "${SOURCE_ROOT}/scripts/__backup.sh"
check_present "the monitor image installs it at the scheduler's path" \
  'COPY scripts/__backup.sh /usr/local/bin/cms-backup.sh' \
  "${SOURCE_ROOT}/docker/monitor/Dockerfile"
check_present "compose bind-mounts it at the scheduler's path" \
  './scripts/__backup.sh:/usr/local/bin/cms-backup.sh' \
  "${SOURCE_ROOT}/docker-compose.yml"

printf '== the no-schedule-row gap announces itself ==\n'
clear_archives
run_monitor
if monitor_says_stale; then
  ok "an empty backup tree is reported on the monitor's cycle"
else
  no "an empty backup tree is reported on the monitor's cycle"
fi

clear_archives
place_archive 'cmsdb-20260101-000000.dump' 72
run_monitor
if monitor_says_stale; then
  ok "an archive older than the window is reported"
else
  no "an archive older than the window is reported"
fi

clear_archives
place_archive 'cmsdb-20260101-000000.dump' 0
run_monitor
if monitor_says_stale; then
  no "a fresh archive is not reported"
else
  ok "a fresh archive is not reported"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
