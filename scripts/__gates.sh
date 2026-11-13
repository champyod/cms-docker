#!/usr/bin/env bash
# gates — every repository gate, in the order CI runs them, in one place.
#
# WHY one runner: CI needs the list twice (a run, and a re-run to quote in the pull-request
# comment). Two copies of six commands is how a comment ends up talking about a gate that is not
# the one that failed.
#
# Usage: __gates.sh            exit 0 when every gate passes, 1 when any fails
# GATES_DIR overrides where the gate scripts live (the test points it at stubs).
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GATES_DIR="${GATES_DIR:-${SCRIPT_DIR}}"

# name|script|args — one line per gate, the same names the job steps used to carry.
GATES=(
  "VAR_SPEC parity|__check_spec_parity.sh|"
  "Variable coverage|__check_var_coverage.sh|"
  "Audit coverage|__check_audit_coverage.sh|"
  "Permission parity|__check_permission_parity.sh|"
  "RLS coverage|__check_rls_coverage.sh|"
  "RLS SQL freshness|__generate_rls_sql.sh|--check"
)

failed=0
for entry in "${GATES[@]}"; do
  IFS='|' read -r name script args <<< "$entry"
  printf '\n== %s ==\n' "$name"
  # An array, not a string: the freshness gate takes a flag, and word-splitting a path is how a
  # directory with a space turns into "no such command".
  cmd=(bash "${GATES_DIR}/${script}")
  [[ -n "$args" ]] && cmd+=("$args")
  if "${cmd[@]}"; then
    printf 'ok: %s\n' "$name"
  else
    printf 'FAILED: %s\n' "$name"
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  printf '\none or more gates failed — see the FAILED lines above\n'
fi
exit $failed
