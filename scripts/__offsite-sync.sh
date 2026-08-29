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
# Config - NO HARDCODED DEFAULTS
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
OFFSITE_TAILNET_NODE="${OFFSITE_TAILNET_NODE:-}"
OFFSITE_REMOTE_PATH="${OFFSITE_REMOTE_PATH:-}"
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
  OFFSITE_TAILNET_NODE    Remote Tailscale IP (REQUIRED - no default)
  OFFSITE_REMOTE_PATH     Remote destination path (REQUIRED - no default)
  OFFSITE_ENCRYPT_KEY     GPG symmetric encryption key (optional)

Behavior:
  - Syncs latest backups/*.tar.gz files to $OFFSITE_TAILNET_NODE
  - Destination: $OFFSITE_REMOTE_PATH/$DATE_STAMP/
  - If OFFSITE_ENCRYPT_KEY is set, encrypts with gpg --symmetric before transfer
  - Dry-run prints the rsync command without executing
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
# Validation
# ---------------------------------------------------------------------------
[[ -n "$OFFSITE_TAILNET_NODE" ]] || log_die "OFFSITE_TAILNET_NODE not set in .env.infra — no default" 1
[[ -n "$OFFSITE_REMOTE_PATH" ]] || log_die "OFFSITE_REMOTE_PATH not set in .env.infra — no default" 1
[[ -d "$BACKUP_DIR" ]] || log_die "backup dir not found: $BACKUP_DIR" 1

mapfile -t ARCHIVES < <(ls -1t "${BACKUP_DIR}"/*.tar.gz 2>/dev/null || true)
(( ${#ARCHIVES[@]} > 0 )) || log_die "no backup archives (*.tar.gz) found in $BACKUP_DIR" 1

REMOTE_DIR="${OFFSITE_REMOTE_PATH}/${DATE_STAMP}"

# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------
encrypt_archive() {
  local src="$1"
  [[ -n "$OFFSITE_ENCRYPT_KEY" ]] || return 0
  local dst="${src}.gpg"
  if [[ "$MODE" == "apply" ]]; then
    gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$OFFSITE_ENCRYPT_KEY" -o "$dst" "$src"
  else
    echo "gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase '***' -o ${dst} ${src}"
  fi
}

if [[ "$MODE" == "apply" ]]; then
  ssh "$OFFSITE_TAILNET_NODE" "mkdir -p '${REMOTE_DIR}'"
  for archive in "${ARCHIVES[@]}"; do
    encrypt_archive "$archive"
    rsync -avz "${archive}${OFFSITE_ENCRYPT_KEY:+.gpg}" "${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/"
  done
  log_info "Offsite sync complete → ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/"
else
  echo "ssh ${OFFSITE_TAILNET_NODE} mkdir -p '${REMOTE_DIR}'"
  for archive in "${ARCHIVES[@]}"; do
    encrypt_archive "$archive"
    echo "rsync -avz ${archive}${OFFSITE_ENCRYPT_KEY:+.gpg} ${OFFSITE_TAILNET_NODE}:${REMOTE_DIR}/"
  done
  log_info "Dry run — re-run with --apply to execute"
fi