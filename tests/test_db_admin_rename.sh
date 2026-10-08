#!/usr/bin/env bash
# tests/test_db_admin_rename.sh — pin the statements `__db_admin.sh rename` runs.
#
# WHY dry-run is the seam: the real path needs a live container and drops
# sessions, so the SQL is asserted through --dry-run, which prints the same
# variables the real path executes in the same order.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DB_ADMIN="${REPO_ROOT}/scripts/__db_admin.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

OUT="$(cd "$REPO_ROOT" && bash "$DB_ADMIN" rename cmsdb cmsdb_evaluate --dry-run 2>&1)"
RC=$?

check_has() { # <label> <substring>
  if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then ok "$1"; else no "$1 (missing: $2)"; fi
}
check_absent() { # <label> <substring>
  if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then no "$1 (present: $2)"; else ok "$1"; fi
}
line_of() { # <substring> — first matching line number, empty when absent
  printf '%s\n' "$OUT" | grep -Fn -- "$1" | head -1 | cut -d: -f1
}
check_before() { # <label> <first substring> <second substring>
  local first second
  first="$(line_of "$2")"
  second="$(line_of "$3")"
  if [[ -n "$first" && -n "$second" && "$first" -lt "$second" ]]; then
    ok "$1"
  else
    no "$1 (line ${first:-?} is not before ${second:-?})"
  fi
}

printf '\n== rename --dry-run exits clean ==\n'
if [[ "$RC" -eq 0 ]]; then ok "rename --dry-run exits 0"; else no "rename --dry-run exits 0 (got ${RC})"; fi

printf '\n== the statements the rename runs ==\n'
check_has "blocks new connections" 'ALTER DATABASE "cmsdb" WITH ALLOW_CONNECTIONS false;'
check_has "drops the attached sessions" 'pg_terminate_backend(pid)'
check_has "renames under the blocked state" 'ALTER DATABASE "cmsdb" RENAME TO "cmsdb_evaluate";'
check_has "re-opens the new name" 'ALTER DATABASE "cmsdb_evaluate" WITH ALLOW_CONNECTIONS true;'
check_absent "no longer tells the operator to stop core" 'core-stop'
check_absent "no longer tells the operator to stop core (prose)" 'stop core'

printf '\n== the order is what keeps the rename unblocked ==\n'
check_before "the block precedes the terminate" 'ALLOW_CONNECTIONS false;' 'pg_terminate_backend(pid)'
check_before "the terminate precedes the rename" 'pg_terminate_backend(pid)' 'RENAME TO "cmsdb_evaluate";'
check_before "the rename precedes the re-open" 'RENAME TO "cmsdb_evaluate";' 'ALLOW_CONNECTIONS true;'

printf '\n== a rename onto the same name is refused ==\n'
if (cd "$REPO_ROOT" && bash "$DB_ADMIN" rename cmsdb cmsdb --dry-run) >/dev/null 2>&1; then
  no "rename cmsdb cmsdb is refused"
else
  ok "rename cmsdb cmsdb is refused"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
