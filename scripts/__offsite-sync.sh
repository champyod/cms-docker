#!/usr/bin/env bash
# scripts/__offsite-sync.sh — Offsite backup synchronization.
#
# Syncs latest backup archives to a remote Tailscale node via rsync.
# Supports optional GPG symmetric encryption before transfer.
# Default mode is dry-run (print only). --apply executes the sync.
#
# Usage:
#   __offsite-sync.sh --dry-run     print rsync command without executing
#   __offsite-sync.sh --apply       sync backups to remote node

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# lib/common.sh
# ---------------------------------------------------------------------------
if [[ -f "${SCRIPT_DIR}/__lib/common.sh" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/__lib/common.sh"
else
  log_info()  { printf '[INFO] %s\n' "$*"; }
  log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
  log_die()   { printf '[FAIL] %s\n' "${1:-fatal error}" >&2; exit "${2:-1}"; }
fi

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
for env_file in "${REPO_ROOT}/.env.infra" "${REPO_ROOT}/.env.core" "${REPO_ROOT}/.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$env_file" 2>/dev/null || true
    set +a
  fi
done

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
OFFSITE_TAILNET_NODE="${OFFSITE_TAILNET_NODE:-100.75.203.112}"
OFFSITE_REMOTE_PATH="${OFFSITE_REMOTE_PATH:-/var/local/backups/cms}"
OFFSITE_ENCRYPT_KEY="${OFFSITE_ENCRYPT_KEY:-}"
DATE_STAMP="$(date +%Y-%m-%d)"
DRY_RUN=1

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
Usage: __offsite-sync.sh <mode>

Modes:
  --dry-run    Print rsync command without executing (default)
  --apply      Sync backups to remote node

Environment (.env.infra):
  OFFSITE_TAILNET_NODE    Remote Tailscale IP (default: 100.75.203.112)
  OFFSITE_REMOTE_PATH     Remote destination path (default: /var/local/backups/cms)
  OFFSITE_ENCRYPT_KEY     GPG symmetric encryption key (optional)

Behavior:
  - Syncs latest backups/*.tar.gz files to $OFFSITE_TAILNET_NODE
  - Destination: $OFFSITE_REMOTE_PATH/$DATE_STAMP/
  - If OFFSITE_ENCRYPT_KEY is set, encrypts with gpg --symmetric before transfer
  - Dry-run prints the rsync command without executing
  - Creates systemd timer templates for daily sync
EOF
}

# ---------------------------------------------------------------------------
# Sync subcommand
# ---------------------------------------------------------------------------
cmd_sync() {
  log_info "Offsite sync — mode: $([ "$DRY_RUN" -eq 1 ] && echo 'DRY-RUN' || echo 'APPLY')"
  log_info "Source: $BACKUP_DIR"
  log_info "Target: ${OFFSITE_TAILNET_NODE}:${OFFSITE_REMOTE_PATH}/${DATE_STAMP}/"

  # Find backup archives
  local archives=()
  while IFS= read -r -d '' f; do
    archives+=("$f")
  done < <(find "$BACKUP_DIR" -maxdepth 2 -name '*.tar.gz' -print0 2>/dev/null || true)

  if [[ ${#archives[@]} -eq 0 ]]; then
    log_warn "No backup archives found in $BACKUP_DIR"
    return 0
  fi

  log_info "Found ${#archives[@]} backup archive(s)"

  # Build rsync command
  local remote_dest="${OFFSITE_TAILNET_NODE}:${OFFSITE_REMOTE_PATH}/${DATE_STAMP}/"
  local rsync_args=(
    -avz --progress
    --timeout=30
    --contimeout=10
  )

  if [[ "$DRY_RUN" -eq 1 ]]; then
    rsync_args+=(--dry-run)
  fi

  # Handle encryption
  if [[ -n "$OFFSITE_ENCRYPT_KEY" ]]; then
    log_info "Encryption enabled (GPG symmetric)"
    _sync_encrypted "${archives[@]}"
  else
    log_info "No encryption key set — syncing unencrypted"
    rsync "${rsync_args[@]}" "${archives[@]}" "$remote_dest" || {
      log_warn "rsync failed"
      return 1
    }
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log_info "[dry-run] rsync would transfer ${#archives[@]} file(s) to $remote_dest"
  else
    log_info "Sync complete — ${#archives[@]} file(s) transferred to $remote_dest"
  fi
}

_sync_encrypted() {
  local archives=("$@")
  local remote_dest="${OFFSITE_TAILNET_NODE}:${OFFSITE_REMOTE_PATH}/${DATE_STAMP}/"
  local tmp_dir
  tmp_dir="$(mktemp -d /tmp/cms-offsite-XXXXXX)"
  trap 'rm -rf "$tmp_dir"' EXIT

  for archive in "${archives[@]}"; do
    local basename
    basename="$(basename "$archive")"
    local enc_file="${tmp_dir}/${basename}.gpg"

    if [[ "$DRY_RUN" -eq 1 ]]; then
      log_info "[dry-run] would encrypt $archive -> $enc_file"
    else
      gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase "$OFFSITE_ENCRYPT_KEY" \
        -o "$enc_file" "$archive" \
        || log_die "GPG encryption failed for $archive" 1
      log_info "encrypted $basename -> $(basename "$enc_file")"
    fi
  done

  # Sync encrypted files
  local rsync_args=(
    -avz --progress
    --timeout=30
    --contimeout=10
  )
  [[ "$DRY_RUN" -eq 1 ]] && rsync_args+=(--dry-run)

  rsync "${rsync_args[@]}" "${tmp_dir}/" "$remote_dest" || {
    log_warn "rsync failed after encryption"
    return 1
  }

  rm -rf "$tmp_dir"
  trap - EXIT
}

# ---------------------------------------------------------------------------
# Systemd timer generation
# ---------------------------------------------------------------------------
cmd_generate_timer() {
  local svc_file="${REPO_ROOT}/config/systemd/offsite-sync.service"
  local timer_file="${REPO_ROOT}/config/systemd/offsite-sync.timer"

  if [[ -f "$svc_file" && -f "$timer_file" ]]; then
    log_info "systemd units already exist:"
    log_info "  $svc_file"
    log_info "  $timer_file"
    log_info "To install: sudo cp $svc_file $timer_file /etc/systemd/system/ && sudo systemctl daemon-reload"
    return 0
  fi

  log_info "systemd unit templates already exist in config/systemd/"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; MODE="${MODE:-sync}"; shift ;;
    --apply)   DRY_RUN=0; MODE="${MODE:-sync}"; shift ;;
    --timer)   MODE="timer"; shift ;;
    --help|-h) usage; exit 0 ;;
    *)         log_die "unknown option: $1 — see --help" 1 ;;
  esac
done

case "$MODE" in
  sync)  cmd_sync ;;
  timer) cmd_generate_timer ;;
  "")    DRY_RUN=1; cmd_sync ;;
  *)     log_die "unknown mode: $MODE" 1 ;;
esac
