#!/usr/bin/env bash
# tests/test_backup_offsite.sh — the offsite copy is encrypted, proven, and reported.
#
# WHY this suite exists: __offsite-sync.sh used to return 0 from its encryption step when no
# key was configured, so with no key the plain tar.gz — the whole database — was rsynced to
# another host and the run still logged "Offsite sync complete". Nothing in the script, the
# log or the exit status said the copy had left in the clear. Three facts have to hold now,
# and each of them is a way the old shape fails:
#
#   1. no key is a REFUSAL, not a quiet fallback, and the operator who really wants a
#      plaintext copy has to say so once, on purpose;
#   2. the passphrase never reaches a process command line (/proc/<pid>/cmdline is world
#      readable, so this is the same leak the database password had);
#   3. the archive is proven to be ciphertext before it is sent, and a transfer that fails
#      cannot leave the run looking successful.
#
# Usage: bash tests/test_backup_offsite.sh
set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The harness resolves its own paths, so shellcheck cannot follow it.
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/offsite_harness.sh"
set -u

# ---------------------------------------------------------------------------
# 1. No key: refused, named, and nothing is shipped
# ---------------------------------------------------------------------------
printf '== without a key the run refuses instead of shipping plaintext ==\n'
new_offsite_root no-key
run_offsite "$PATH_REAL" --apply OFFSITE_ENCRYPT_KEY=""
expect_exit "no key is a failed run, not a silent plaintext shipment" "1"
check_eq "the reason is named in the run log" "yes" "$(log_has 'OFFSITE_ENCRYPT_KEY is empty')"
check_eq "the operator is told how to accept plaintext" "yes" "$(log_has 'OFFSITE_ALLOW_PLAINTEXT=1')"
check_eq "the remote was never even asked to create a directory" "no" "$(stub_has 'ssh ')"
check_eq "nothing was transferred" "0" "$(shipped_files)"
check_eq "no offsite success was recorded" "no" \
  "$(test -e "$(offsite_state_file)" && printf yes || printf no)"

# A dry run is not an escape hatch: it is the mode an operator reads before deciding, and a
# plan that says "this would ship your database in the clear" has to be the plan it prints.
new_offsite_root no-key-dry
run_offsite "$PATH_REAL" --dry-run OFFSITE_ENCRYPT_KEY=""
expect_exit "the dry run refuses for the same reason" "1"
check_eq "the dry run names the missing key" "yes" "$(log_has 'OFFSITE_ENCRYPT_KEY is empty')"

# ---------------------------------------------------------------------------
# 2. The override: allowed, loud, and recorded as plaintext
# ---------------------------------------------------------------------------
printf '\n== the documented override ships plaintext, loudly, and says so in the metric ==\n'
new_offsite_root override
run_offsite "$PATH_REAL" --apply OFFSITE_ENCRYPT_KEY="" OFFSITE_ALLOW_PLAINTEXT=1
expect_exit "the override lets the run complete" "0"
check_eq "the override is announced before anything moves" "yes" \
  "$(log_has 'plaintext override enabled')"
check_eq "the warning names what is exposed" "yes" "$(log_has 'UNENCRYPTED')"
check_eq "the completion line does not read as a clean success" "yes" \
  "$(log_has 'PLAINTEXT archive')"
check_eq "one archive was sent" "1" "$(shipped_files)"
check_eq "the archive that was sent is the plaintext one" "yes" \
  "$(cmp -s -- "$ARCHIVE" "${RUN_ROOT}/remote/cmsdb-20260101-000000.tar.gz" && printf yes || printf no)"
check_eq "the metric records that the copy is not encrypted" "0" \
  "$(metric_value cms_offsite_last_ship_encrypted)"
check_eq "the state file records it too" "0" "$(state_value OFFSITE_LAST_SHIP_ENCRYPTED)"

# ---------------------------------------------------------------------------
# 3. The passphrase never appears on a command line
# ---------------------------------------------------------------------------
printf '\n== the passphrase is on a file descriptor, not in argv ==\n'
new_offsite_root argv
run_offsite "$PATH_ARGV" --apply
expect_exit "the encrypted run completes" "0"
ARGV_LINE="$(grep '^gpg-argv ' "$STUB_LOG" | head -n 1 || true)"
check_eq "gpg was invoked" "yes" "$(has_yes "$ARGV_LINE" 'gpg-argv')"
check_eq "gpg received the passphrase on a file descriptor" "yes" \
  "$(has_yes "$ARGV_LINE" '--passphrase-fd')"
check_eq "the passphrase itself is absent from the command line" "no" \
  "$(has_yes "$ARGV_LINE" "$STUB_KEY")"
# `--passphrase x` and `--passphrase=x` are the two shapes the leak had; `--passphrase-fd`
# is the fix, so only those two are refused.
check_eq "no --passphrase argument form is used" "no" \
  "$(printf '%s\n' "$ARGV_LINE" | grep -qE -- '--passphrase[ =]' && printf yes || printf no)"
check_eq "the ciphertext was still produced" "1" "$(shipped_files)"

# ---------------------------------------------------------------------------
# 4. The shipped bytes are real ciphertext that decrypts to the archive
# ---------------------------------------------------------------------------
printf '\n== what leaves the host is ciphertext and it decrypts back to the archive ==\n'
new_offsite_root ciphertext
run_offsite "$PATH_REAL" --apply
expect_exit "the encrypted run completes" "0"
SHIPPED="${RUN_ROOT}/remote/cmsdb-20260101-000000.tar.gz.gpg"
check_eq "the shipped file carries the .gpg suffix" "yes" \
  "$(test -f "$SHIPPED" && printf yes || printf no)"
check_eq "the shipped bytes are not the plaintext archive" "no" \
  "$(cmp -s -- "$ARCHIVE" "$SHIPPED" && printf yes || printf no)"
check_eq "the gzip header of the archive is gone" "no" \
  "$(test "$(od -An -tx1 -N2 -- "$SHIPPED" 2>/dev/null | tr -d ' \n')" = "1f8b" && printf yes || printf no)"
check_eq "gpg reads the shipped file as symmetric ciphertext" "yes" \
  "$(gpg --batch --quiet --pinentry-mode loopback --list-packets --passphrase-fd 3 \
       -- "$SHIPPED" 3< <(printf '%s' "$STUB_KEY") 2>/dev/null |
     grep -q ':symkey enc packet:' && printf yes || printf no)"
check_eq "the archive decrypts with the configured key, byte for byte" "yes" \
  "$(env -i PATH="/usr/bin:/bin" HOME="${RUN_ROOT}/home" gpg --batch --quiet --pinentry-mode loopback \
       --passphrase-fd 3 --decrypt --output "${RUN_ROOT}/decrypted" \
       -- "$SHIPPED" 3< <(printf '%s' "$STUB_KEY") 2>/dev/null &&
     cmp -s -- "$ARCHIVE" "${RUN_ROOT}/decrypted" && printf yes || printf no)"
check_eq "the run says the archive was verified" "yes" "$(log_has 'verified:')"
check_eq "the metric records an encrypted copy" "1" "$(metric_value cms_offsite_last_ship_encrypted)"

# ---------------------------------------------------------------------------
# 5. Encryption is verified, not assumed
# ---------------------------------------------------------------------------
# The stub here is a gpg that "encrypts" by copying the file: the shape of a key that does
# not do what it says, or of a pipeline that lost the gpg step. A verifier that trusted the
# tool's exit status would ship the database in the clear and call it encrypted.
printf '\n== a copy that only calls itself encrypted is refused ==\n'
new_offsite_root fake-encryption
run_offsite "$PATH_COPY" --apply
expect_exit "an unverified archive fails the run" "1"
check_eq "the reason names the plaintext header" "yes" \
  "$(log_has 'still begins with the gzip header')"
check_eq "nothing was transferred" "0" "$(shipped_files)"
check_eq "no offsite success was recorded" "no" \
  "$(test -e "$(offsite_state_file)" && printf yes || printf no)"

# ---------------------------------------------------------------------------
# 6. A failed transfer cannot leave the run looking successful
# ---------------------------------------------------------------------------
printf '\n== a failed rsync fails the run and does not move the staleness clock ==\n'
new_offsite_root transfer-failure
run_offsite "$PATH_REAL" --apply
expect_exit "the first run (a real transfer) completes" "0"
FIRST_EPOCH="$(state_value OFFSITE_LAST_SHIP_EPOCH)"
sleep 1
run_offsite "$PATH_REAL" --apply STUB_RSYNC_STATUS=23
expect_exit "a failed rsync exits non-zero" "1"
check_eq "the log names the failure and its status" "yes" \
  "$(log_has 'rsync failed for')"
check_eq "the run reports itself incomplete rather than complete" "yes" \
  "$(log_has 'offsite sync INCOMPLETE')"
check_eq "no completion line is printed for a failed transfer" "no" \
  "$(log_has 'Offsite sync complete')"
check_eq "the recorded success is still the earlier one" "$FIRST_EPOCH" \
  "$(state_value OFFSITE_LAST_SHIP_EPOCH)"

# A remote that cannot be reached fails the same way, before anything is encrypted.
new_offsite_root ssh-failure
run_offsite "$PATH_REAL" --apply STUB_SSH_STATUS=255
expect_exit "an unreachable node fails the run" "1"
check_eq "the log says the remote directory was not created" "yes" \
  "$(log_has 'could not create')"
check_eq "no archive was sent" "0" "$(shipped_files)"

# ---------------------------------------------------------------------------
# 7. Staleness is a datum the monitoring stack can read
# ---------------------------------------------------------------------------
printf '\n== the age of the newest offsite copy is published as a metric ==\n'
new_offsite_root staleness
BEFORE="$(date +%s)"
run_offsite "$PATH_REAL" --apply
AFTER="$(date +%s)"
expect_exit "the sync completes" "0"
check_eq "the monitoring textfile exists" "yes" \
  "$(test -f "$(metrics_file)" && printf yes || printf no)"
SHIP_TS="$(metric_value cms_offsite_last_ship_timestamp_seconds)"
check_eq "it carries the offsite ship timestamp" "yes" \
  "$([[ "$SHIP_TS" =~ ^[0-9]+$ ]] && (( SHIP_TS >= BEFORE && SHIP_TS <= AFTER )) && printf yes || printf no)"
check_eq "the copy is not stale right after shipping" "0" "$(metric_value cms_offsite_stale)"
check_eq "its age is seconds, and it is fresh" "0" "$(metric_value cms_offsite_last_ship_age_seconds)"
check_eq "it carries how many archives landed" "1" "$(metric_value cms_offsite_last_ship_archives)"

# The same datum, aged: an epoch two days old has to read as stale, because the whole point
# is that a copy nobody refreshed stops looking healthy.
printf 'OFFSITE_LAST_SHIP_EPOCH=%s\nOFFSITE_LAST_SHIP_ENCRYPTED=1\nOFFSITE_LAST_SHIP_ARCHIVES=1\nOFFSITE_LAST_SHIP_DESTINATION=%s\n' \
  "$(( AFTER - 172800 ))" "${STUB_NODE}:${STUB_REMOTE_PATH}" > "$(offsite_state_file)"
# shellcheck source=/dev/null
source "${STAGE_REPO}/scripts/__lib/common.sh"
set +eu +o pipefail
set -u
publish_backup_metrics "${RUN_ROOT}/backups"
check_eq "a copy two days old is stale" "1" "$(metric_value cms_offsite_stale)"
check_eq "and its age is those two days" "yes" \
  "$(AGED_AGE="$(metric_value cms_offsite_last_ship_age_seconds)"
     [[ "$AGED_AGE" =~ ^[0-9]+$ ]] && (( AGED_AGE >= 172800 && AGED_AGE < 172900 )) && printf yes || printf no)"

# A local backup that has never succeeded is not a green light either: 0 is "never", the
# age is the whole age of the box, and stale is 1.
check_eq "no local backup success reads as never, not as fresh" "0" \
  "$(metric_value cms_backup_last_success_timestamp_seconds)"
check_eq "and it is stale" "1" "$(metric_value cms_backup_stale)"

# ---------------------------------------------------------------------------
printf '\nPASS: %d  FAIL: %d' "$PASS" "$FAIL"
if (( FAIL > 0 )); then printf '  FAILED\n'; exit 1; fi
printf '  ALL PASS\n'
