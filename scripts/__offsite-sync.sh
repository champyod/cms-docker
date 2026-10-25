#!/usr/bin/env bash
# scripts/__offsite-sync.sh — Offsite backup synchronization.
#
# Syncs the newest backup archives to a remote Tailscale node via rsync. Every archive
# is encrypted with gpg before it leaves this host, and the archive is proven to be
# ciphertext before anything is sent — an offsite copy that is not encrypted is refused,
# not shipped quietly. A plaintext shipment has to be asked for, once, on purpose:
# OFFSITE_ALLOW_PLAINTEXT=1 (see the banner it prints).
#
# Default mode is dry-run (print only). --apply executes the sync.
#
# Usage:
#   __offsite-sync.sh --dry-run     print the commands without executing them
#   __offsite-sync.sh --apply       encrypt, verify and sync to the remote node

set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env" 2>/dev/null || true
  set +a
fi

# ---------------------------------------------------------------------------
# Config - NO HARDCODED DEFAULTS
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
OFFSITE_TAILNET_NODE="${OFFSITE_TAILNET_NODE:-}"
OFFSITE_REMOTE_PATH="${OFFSITE_REMOTE_PATH:-}"
OFFSITE_ENCRYPT_KEY="${OFFSITE_ENCRYPT_KEY:-}"
# WHY 0 and not "": the override is a decision, so an unset variable and a variable set to
# 0 have to mean the same thing — "no" — and anything else is refused rather than guessed.
OFFSITE_ALLOW_PLAINTEXT="${OFFSITE_ALLOW_PLAINTEXT:-0}"
DATE_STAMP="$(date +%Y-%m-%d)"
DRY_RUN=1
ENCRYPT=1
# Why not defaulted here: set_encryption_policy owns it, so the parse happens in one place
# and a caller reading the policy reads one function.
PLAINTEXT_ALLOWED=0

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: __offsite-sync.sh <mode>

Modes:
  --dry-run    Print the commands without executing them (default)
  --apply      Encrypt, verify and sync the archives to the remote node

Environment (.env [infra] section):
  OFFSITE_TAILNET_NODE     Remote Tailscale IP (REQUIRED - no default)
  OFFSITE_REMOTE_PATH      Remote destination path (REQUIRED - no default)
  OFFSITE_ENCRYPT_KEY      GPG symmetric passphrase (REQUIRED for --apply)
  OFFSITE_ALLOW_PLAINTEXT  Set to 1 to ship UNENCRYPTED archives on purpose

Behavior:
  - Syncs the newest backups/*.tar.gz files to $OFFSITE_TAILNET_NODE
  - Destination: $OFFSITE_REMOTE_PATH/$DATE_STAMP/
  - Every archive is encrypted with gpg --symmetric (AES256) and then PROVEN encrypted
    before it is sent: gpg must read it as symmetric ciphertext, the archive's own gzip
    header must be gone, and the key must decrypt it back byte for byte
  - The passphrase reaches gpg through a file descriptor, never through argv
  - With no OFFSITE_ENCRYPT_KEY and no override the run fails: nothing is shipped
  - A failed encryption, verification or rsync makes the run exit non-zero and the run
    records no offsite success
  - Dry-run prints the commands without executing them (it still refuses without a key)
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
MODE="dry-run"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --apply)   MODE="apply"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) log_die "unknown option: $1 — see --help" 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Encryption policy — the gate that makes a plaintext shipment impossible to ship silently
# ---------------------------------------------------------------------------
# WHY this is a refusal and not a warning: the previous behaviour returned 0 from the
# encryption step when no key was configured, so the rsync that followed copied the
# plain tar.gz to another host and every log line still read "Offsite sync complete".
# That is a backup that looks taken and is readable by anyone who reaches the remote
# node, the ssh path, or either filesystem — the worst possible way to lose a database.
# Fail closed: the operator either configures a key or says, in so many words, that this
# one run may leave the host in the clear. The override is deliberately NOT a config.toml
# key: it is typed for one run, and it cannot be switched on permanently by a config sync.
set_encryption_policy() {
  case "$OFFSITE_ALLOW_PLAINTEXT" in
    1|true|yes) PLAINTEXT_ALLOWED=1 ;;
    0|""|false|no) PLAINTEXT_ALLOWED=0 ;;
    *)
      log_die "OFFSITE_ALLOW_PLAINTEXT must be 1 or 0 — got '${OFFSITE_ALLOW_PLAINTEXT}'" 1
      ;;
  esac

  if [[ -n "$OFFSITE_ENCRYPT_KEY" ]]; then
    ENCRYPT=1
    if (( PLAINTEXT_ALLOWED == 1 )); then
      # WHY not an error: the operator asked for plaintext but also configured a key, and
      # a key present is strictly safer. Say so, because the override state and the
      # shipped state then disagree and the log is the only place that can reconcile them.
      log_warn "OFFSITE_ALLOW_PLAINTEXT=1 is set but OFFSITE_ENCRYPT_KEY is also configured — shipping ENCRYPTED archives; the override changes nothing while a key exists"
    fi
    return 0
  fi

  if (( PLAINTEXT_ALLOWED == 1 )); then
    ENCRYPT=0
    log_warn "==========================================================="
    log_warn "OFFSITE_ALLOW_PLAINTEXT=1 — the archives will be copied to"
    log_warn "${OFFSITE_TAILNET_NODE}:${OFFSITE_REMOTE_PATH} UNENCRYPTED."
    log_warn "Anyone who can read that host, that filesystem or the"
    log_warn "ssh path between them can read the whole database."
    log_warn "This run records cms_offsite_last_ship_encrypted 0."
    log_warn "Unset OFFSITE_ALLOW_PLAINTEXT to restore the refusal."
    log_warn "==========================================================="
    log_warn "plaintext override enabled — shipping unencrypted archives (OFFSITE_ALLOW_PLAINTEXT=1)"
    return 0
  fi

  log_warn "A backup that leaves this host unencrypted is readable by anyone who reaches the"
  log_warn "remote node or the path to it, and nothing in this run would have said so."
  log_warn "Fix: set OFFSITE_ENCRYPT_KEY in config.toml [infra] (openssl rand -hex 32) and"
  log_warn "     run './cms config sync', or export it for this run only."
  log_warn "To ship unencrypted on purpose, for this run only:"
  log_warn "     OFFSITE_ALLOW_PLAINTEXT=1 bash scripts/__offsite-sync.sh --apply"
  log_die "refusing to ship a plaintext backup — OFFSITE_ENCRYPT_KEY is empty and OFFSITE_ALLOW_PLAINTEXT is not set" 1
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
[[ -n "$OFFSITE_TAILNET_NODE" ]] || log_die "OFFSITE_TAILNET_NODE not set in .env [infra] — no default" 1
[[ -n "$OFFSITE_REMOTE_PATH" ]] || log_die "OFFSITE_REMOTE_PATH not set in .env [infra] — no default" 1
[[ -d "$BACKUP_DIR" ]] || log_die "backup dir not found: $BACKUP_DIR" 1

mapfile -t ARCHIVES < <(ls -1t "${BACKUP_DIR}"/*.tar.gz 2>/dev/null || true)
(( ${#ARCHIVES[@]} > 0 )) || log_die "no backup archives (*.tar.gz) found in $BACKUP_DIR" 1

# WHY the newest audit-log archive rides along: nothing else on this host holds the audit trail, and
# `backups/db/cmsdb-*.dump` is not in the *.tar.gz set either — those tarballs are the panel's
# volume archives. The audit archive is small, self-contained, and its absence offsite is exactly
# the gap D3 named ("no offsite copy"), so it ships even when nothing else from db/ does. A missing
# one is not fatal on its own: an operator who has not taken a backup yet has nothing to ship, and
# the run says so instead of failing the volume archives with it.
newest_audit_archive="$(ls -1t "${BACKUP_DIR}/db/audit-log-"*.dump 2>/dev/null | head -n1 || true)"
if [[ -n "$newest_audit_archive" && -f "$newest_audit_archive" ]]; then
  ARCHIVES+=("$newest_audit_archive")
  log_info "shipping the audit-log archive too: $(basename -- "$newest_audit_archive")"
else
  log_warn "no audit-log archive in ${BACKUP_DIR}/db — this offsite copy will not carry the audit trail"
fi

set_encryption_policy

if (( ENCRYPT == 1 )) && ! command -v gpg >/dev/null 2>&1; then
  log_die "OFFSITE_ENCRYPT_KEY is set but gpg is not installed — refusing to ship a plaintext backup instead" 1
fi

REMOTE_DIR="${OFFSITE_REMOTE_PATH}/${DATE_STAMP}"

# ---------------------------------------------------------------------------
# gpg — the passphrase never reaches argv
# ---------------------------------------------------------------------------
# WHY --passphrase-fd and not --passphrase: --passphrase puts the key in gpg's own
# command line, and /proc/<pid>/cmdline is world readable, so every local account reads
# the backup passphrase for the whole run — the same leak the database password had
# before docker_exec_db handed it over through the environment instead. The key is fed
# on fd 3 from a shell builtin's pipe: no argv, no file on disk, and nothing for another
# account to read. --no-symkey-cache keeps the agent from holding the passphrase after
# the run; the flag is probed rather than assumed so an older gpg still runs.
GPG_COMMON=(--batch --yes --quiet)
GPG_ENCRYPT=(--symmetric --cipher-algo AES256)
if [[ -n "$OFFSITE_ENCRYPT_KEY" ]]; then
  GPG_COMMON+=(--pinentry-mode loopback)
  gpg_options="$(gpg --dump-options 2>/dev/null || true)"
  if [[ "$gpg_options" == *"--no-symkey-cache"* ]]; then
    GPG_COMMON+=(--no-symkey-cache)
  fi
fi

STAGE_DIR=""
cleanup_stage() {
  if [[ -n "${STAGE_DIR:-}" && -d "${STAGE_DIR:-}" ]]; then
    rm -rf -- "$STAGE_DIR"
  fi
}
trap cleanup_stage EXIT

make_stage_dir() {
  if [[ -z "$STAGE_DIR" ]]; then
    # 700 and removed on exit: the staged ciphertext is a full copy of the database, and
    # the directory every local account can write to is the one place it must not sit.
    STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cms-offsite.XXXXXX")"
    chmod 700 "$STAGE_DIR" 2>/dev/null || true
  fi
}

encrypt_archive() { # <src> <dst>
  local src="$1" dst="$2"
  # WHY 3< <(...) and not a here-string: a here-string is a temporary file on disk, and
  # a pipe from a builtin is not. printf is a bash builtin, so the key is never an argv
  # element of any process at all.
  if ! gpg "${GPG_COMMON[@]}" "${GPG_ENCRYPT[@]}" --passphrase-fd 3 --output "$dst" -- "$src" \
      3< <(printf '%s' "$OFFSITE_ENCRYPT_KEY"); then
    rm -f -- "$dst"
    return 1
  fi
  chmod 600 "$dst" 2>/dev/null || true
}

verify_encrypted() { # <src> <dst>
  local src="$1" dst="$2"
  local magic packets src_sha dec_sha

  if [[ ! -s "$dst" ]]; then
    log_warn "verification: ${dst} is missing or empty"
    return 1
  fi

  # 1) The plaintext header is gone. The archive is a gzip stream, so its first two
  #    bytes are 1f 8b; finding them in the "ciphertext" means the file was copied, not
  #    encrypted. od is used instead of `file` because od is in coreutils on every host
  #    and `file` is not installed everywhere this script may run.
  magic="$(od -An -tx1 -N2 -- "$dst" 2>/dev/null | tr -d ' \n')"
  if [[ "$magic" == "1f8b" ]]; then
    log_warn "verification: ${dst} still begins with the gzip header of the archive — it is a copy, not ciphertext"
    return 1
  fi

  # 2) gpg reads it as what it claims: a symmetric-key session packet wrapping encrypted
  #    data. WHY the passphrase is offered here and the exit status is not the test: a
  #    --list-packets call that has no passphrase tries to reach a pinentry, and on a host
  #    with no agent for this user it BLOCKS — a backup that hangs is a backup that never
  #    reports. Handing it the key keeps the call non-interactive, so what is asserted is
  #    the packet list itself: a plaintext file produces no :symkey packet at all.
  packets="$(gpg "${GPG_COMMON[@]}" --list-packets --passphrase-fd 3 -- "$dst" \
      3< <(printf '%s' "$OFFSITE_ENCRYPT_KEY") 2>/dev/null || true)"
  if [[ "$packets" != *":symkey enc packet:"* || "$packets" != *":encrypted data packet:"* ]]; then
    log_warn "verification: ${dst} does not read as gpg symmetric ciphertext"
    return 1
  fi

  # 3) The key actually opens it, and what comes out is the archive byte for byte. A
  #    header check alone would pass for a file encrypted with a different key, and the
  #    operator would learn that at restore time, on the worst day.
  #    WHY the decrypted stream is piped into sha256sum instead of written to a file: a
  #    staged plaintext copy is the whole database in the clear, and not producing one is
  #    the entire point of the step being verified.
  src_sha="$(sha256sum -- "$src" | awk '{print $1}')"
  dec_sha=""
  dec_sha="$(gpg "${GPG_COMMON[@]}" --decrypt --passphrase-fd 3 -- "$dst" \
      3< <(printf '%s' "$OFFSITE_ENCRYPT_KEY") 2>/dev/null | sha256sum | awk '{print $1}')" || dec_sha=""
  if [[ -z "$dec_sha" || "$dec_sha" != "$src_sha" ]]; then
    log_warn "verification: ${dst} does not decrypt to the bytes of ${src} with OFFSITE_ENCRYPT_KEY"
    return 1
  fi
  log_info "verified: $(basename -- "$dst") is gpg AES256 ciphertext and decrypts to $(basename -- "$src")"
}

# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------
# WHY every step's status is checked: the run used to end with an unconditional
# "Offsite sync complete" line, so a dead rsync (wrong host, full disk, dropped tailnet)
# produced a success message and nothing else. The exit status is the only thing a
# scheduled caller reads, so a failure has to reach it.
ship_archive() { # <archive> — encrypt, verify, transfer one archive; 0 only if it landed
  local src="$1"
  local base transfer_file shipped_name rsync_status=0

  base="$(basename -- "$src")"
  transfer_file="$src"
  shipped_name="$base"

  if (( ENCRYPT == 1 )); then
    make_stage_dir
    transfer_file="${STAGE_DIR}/${base}.gpg"
    shipped_name="${base}.gpg"
    if ! encrypt_archive "$src" "$transfer_file"; then
      log_warn "encryption failed for ${base} — nothing was sent for it"
      return 1
    fi
    if ! verify_encrypted "$src" "$transfer_file"; then
      log_warn "refusing to send ${base}: the encrypted copy did not verify"
      return 1
    fi
  fi

  rsync -avz -- "$transfer_file" "${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/" || rsync_status=$?
  if (( rsync_status != 0 )); then
    log_warn "rsync failed for ${shipped_name} → ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/ (status ${rsync_status})"
    return 1
  fi
  # WHY the staged ciphertext is removed per archive and not only by the exit trap: a run
  # that ships several archives would otherwise hold a second encrypted copy of the whole
  # backup tree in $TMPDIR until the last one finished.
  if (( ENCRYPT == 1 )); then
    rm -f -- "$transfer_file"
  fi
}

if [[ "$MODE" == "apply" ]]; then
  ssh_status=0
  ssh "$OFFSITE_TAILNET_NODE" "mkdir -p '${REMOTE_DIR}'" || ssh_status=$?
  if (( ssh_status != 0 )); then
    log_warn "could not create ${REMOTE_DIR} on ${OFFSITE_TAILNET_NODE} (ssh status ${ssh_status})"
    log_die "offsite sync failed — the remote directory does not exist, so no archive was sent" 1
  fi

  shipped=0
  failed=0
  for archive in "${ARCHIVES[@]}"; do
    if ship_archive "$archive"; then
      shipped=$(( shipped + 1 ))
    else
      failed=$(( failed + 1 ))
    fi
  done

  if (( failed > 0 )); then
    # WHY no record on a partial run: the state file is what "the newest offsite copy" is
    # measured from, so stamping it here would reset the staleness clock on a run that did
    # not deliver a complete set. The metric is still republished, so the age keeps growing.
    publish_backup_metrics "$BACKUP_DIR" || log_warn "could not publish the backup metrics under $(backup_metrics_dir "$BACKUP_DIR")"
    log_die "offsite sync INCOMPLETE — ${failed} of ${#ARCHIVES[@]} archive(s) did not reach ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/" 1
  fi

  record_offsite_ship "$BACKUP_DIR" "$(date +%s)" "$(( ENCRYPT == 1 ? 1 : 0 ))" "$shipped" "${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}" ||
    log_warn "could not record the offsite success under $(backup_metrics_dir "$BACKUP_DIR")"
  publish_backup_metrics "$BACKUP_DIR" ||
    log_warn "could not publish the backup metrics under $(backup_metrics_dir "$BACKUP_DIR")"

  if (( ENCRYPT == 1 )); then
    log_info "Offsite sync complete (${shipped} encrypted archive(s)) → ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/"
  else
    log_warn "Offsite sync complete (${shipped} PLAINTEXT archive(s)) → ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/ — OFFSITE_ALLOW_PLAINTEXT=1 was set"
  fi
else
  echo "ssh ${OFFSITE_TAILNET_NODE} mkdir -p '${REMOTE_DIR}'"
  for archive in "${ARCHIVES[@]}"; do
    if (( ENCRYPT == 1 )); then
      echo "gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o ${archive}.gpg ${archive}   # passphrase arrives on fd 3, never in argv"
      echo "rsync -avz ${archive}.gpg ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/"
    else
      echo "rsync -avz ${archive} ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/"
    fi
  done
  if (( ENCRYPT == 0 )); then
    log_warn "Dry run would ship PLAINTEXT archives — OFFSITE_ALLOW_PLAINTEXT=1 is set"
  fi
  log_info "Dry run — re-run with --apply to execute"
fi
