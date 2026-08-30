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
  - Creates systemd timer templates for daily sync
EOF
}