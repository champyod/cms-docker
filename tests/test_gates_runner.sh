#!/usr/bin/env bash
# One runner for six gates: it must run all of them, name the ones that failed, and never pass a
# failing gate. The comment step re-runs this exact script, so its list has to be the whole truth.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="${REPO_ROOT}/scripts/__gates.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Derived, not listed: a second copy of the gate list went stale on the seventh gate.
GATE_SCRIPTS=()
while IFS= read -r s; do GATE_SCRIPTS+=("$s"); done < <(
  sed -n '/^GATES=(/,/^)/p' "$RUNNER" | grep -oE '[A-Za-z0-9_]+\.sh' | awk '!seen[$0]++'
)
GATE_NAMES=()
while IFS= read -r n; do GATE_NAMES+=("$n"); done < <(
  sed -n '/^GATES=(/,/^)/p' "$RUNNER" | sed -n 's/^  "\([^|]*\)|.*/\1/p'
)
[[ ${#GATE_SCRIPTS[@]} -gt 0 ]] || { echo "FAIL could not read the gate list from $RUNNER" >&2; exit 1; }

pass=0 fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

# stub_gates <pass|fail> <failing-script-or-empty>
stub_gates() {
  rm -rf "$WORK/gates"; mkdir -p "$WORK/gates"
  local verdict="$1" breaker="${2:-}"
  for s in "${GATE_SCRIPTS[@]}"; do
    if [[ "$s" == "$breaker" ]]; then
      printf '#!/usr/bin/env bash\necho "%s says no"; exit 1\n' "$s" > "$WORK/gates/$s"
    else
      printf '#!/usr/bin/env bash\necho "%s fine"; exit 0\n' "$s" > "$WORK/gates/$s"
    fi
    chmod +x "$WORK/gates/$s"
  done
}

printf '\nall green exits 0 and names every gate\n'
stub_gates pass
out="$(GATES_DIR="$WORK/gates" bash "$RUNNER" 2>&1)"; rc=$?
[[ $rc -eq 0 ]] && ok "exits 0 when every gate passes" || no "exit was $rc"
for n in "${GATE_NAMES[@]}"; do
  grep -q "== ${n} ==" <<< "$out" && ok "ran: ${n}" || no "skipped: ${n}"
done

printf '\n- a failing gate fails the run, and the others still run\n'
stub_gates fail __check_rls_coverage.sh
out="$(GATES_DIR="$WORK/gates" bash "$RUNNER" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && ok "exits 1 when a gate fails" || no "exit was $rc"
grep -q 'FAILED: RLS coverage' <<< "$out" && ok "names the gate that failed" || no "the failure is unnamed"
grep -q '__check_rls_coverage.sh says no' <<< "$out" && ok "carries the gate's own words" || no "the gate's output was swallowed"
grep -q '== RLS SQL freshness ==' <<< "$out" && ok "keeps going after a failure" || no "stopped at the first failure"

printf '\nthe freshness gate receives its flag\n'
rm -rf "$WORK/flag"; mkdir -p "$WORK/flag"
printf '#!/usr/bin/env bash\nprintf "args:%%s\\n" "$*"\n' > "$WORK/flag/__generate_rls_sql.sh"
for s in "${GATE_SCRIPTS[@]}"; do
  [[ "$s" == "__generate_rls_sql.sh" ]] && continue
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/flag/$s"
done
chmod +x "$WORK/flag"/*.sh
out="$(GATES_DIR="$WORK/flag" bash "$RUNNER" 2>&1)"
grep -q 'args:--check' <<< "$out" && ok "passes --check to the generator" || no "the flag never arrived"

printf '\nthe real gates are the ones the job used to run\n'
for s in "${GATE_SCRIPTS[@]}"; do
  [[ -f "${REPO_ROOT}/scripts/${s}" ]] && ok "exists: ${s}" || no "missing: ${s}"
done

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
