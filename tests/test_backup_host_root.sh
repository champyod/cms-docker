#!/usr/bin/env bash
# tests/test_backup_host_root.sh — pin that the host scripts use the host backup tree.
#
# ${BACKUP_DIR} is the in-container path (/app/backups) that compose bind-mounts the
# host tree onto, so a host script that stats it names a directory with nothing
# mounted — the preflight hard-fail this guards.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PREFLIGHT="${REPO_ROOT}/scripts/__preflight.sh"
COMMON="${REPO_ROOT}/scripts/__lib/common.sh"
UPDATE_SERVER="${REPO_ROOT}/scripts/__update-server.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

printf '\n== the host resolves the backup root from the host tree ==\n'
if grep -Fq 'backup_root="${BACKUP_HOST_DIR:-${REPO_ROOT}/backups}"' "$PREFLIGHT"; then
  ok "preflight defaults to the repository backups tree"
else
  no "preflight defaults to the repository backups tree"
fi
if grep -Fq 'root="${BACKUP_HOST_DIR:-${repo_root}/backups}"' "$COMMON"; then
  ok "ensure_backup_dir_perms defaults to the repository backups tree"
else
  no "ensure_backup_dir_perms defaults to the repository backups tree"
fi
if grep -Fq 'backup_root="${BACKUP_DIR:-${REPO_ROOT}/backups}"' "$PREFLIGHT" \
  || grep -Fq 'root="${BACKUP_DIR:-${repo_root}/backups}"' "$COMMON"; then
  no "no host script still defaults the backup root to ${BACKUP_DIR}"
else
  ok "no host script still defaults the backup root to \${BACKUP_DIR}"
fi
# update-server runs the safety backup on the host, where the in-container
# BACKUP_DIR means nothing, so it must hand the script the host root explicitly.
if grep -Fq 'BACKUP_ROOT_HOST="${BACKUP_HOST_DIR:-${REPO_ROOT}/backups}"' "$UPDATE_SERVER"; then
  ok "update-server resolves the host root, not \${BACKUP_DIR}"
else
  no "update-server resolves the host root, not \${BACKUP_DIR}"
fi
if grep -Fq '"$BACKUP_SCRIPT" --root "$BACKUP_ROOT_HOST"' "$UPDATE_SERVER"; then
  ok "update-server retargets the backup script with --root"
else
  no "update-server retargets the backup script with --root"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
