#!/usr/bin/env bash
# The drill must point __backup.sh at drills/ through --root; .env otherwise wins.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/__backup_drill.sh"
pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

if grep -qF 'bash "${SCRIPT_DIR}/__backup.sh" --root "$DRILLS_BACKUP_ROOT"' "$SCRIPT"; then
  ok "the drill passes --root to the backup script"
else
  no "the drill passes --root to the backup script"
fi

if grep -qF 'DRILLS_BACKUP_ROOT=' "$SCRIPT"; then
  ok "the drill defines its own backup root"
else
  no "the drill defines its own backup root"
fi

printf '\nbackup-drill-root: %d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
