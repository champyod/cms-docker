#!/usr/bin/env bash
# Guards the one property that makes the RLS helpers cheap: they must NOT be inlined.
#
# A one-line SQL function is inlined into the policy expression, so `cms_actor_is_staff()` ran once
# per ROW — a regex, two split_parts and two array comparisons times every row of a 34,610-row table,
# on every query the panel makes. A SET clause makes a function non-inlinable, which resolves the
# identity once per statement. Measured before/after on the live database: 25 ms of a 55 ms GROUP BY.
#
# A future edit that drops the clause would silently restore the per-row cost, and no behaviour test
# would notice — the answers stay correct, only the bill changes. That is what this test pins.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; }

GEN=scripts/__generate_rls_sql.sh
MIG=admin-panel/prisma/migrations/20261026140200_rls_helpers_not_inlined/migration.sql

[[ -x $GEN || -r $GEN ]] && pass "generator is readable" || fail "generator missing: $GEN"

emitted=$(bash "$GEN" --emit-policies 2>/dev/null)
[[ -n $emitted ]] && pass "generator emits SQL" || fail "generator emitted nothing"

# Every policy helper must carry the clause. Counted, not eyeballed: the generator defines exactly
# five, and the assertion fails if a sixth appears without one.
defs=$(printf '%s\n' "$emitted" | grep -c '^CREATE OR REPLACE FUNCTION public\.cms_actor')
with_set=$(printf '%s\n' "$emitted" | grep -c '^  SET search_path = pg_catalog, public$')

[[ $defs -eq 5 ]] && pass "generator defines 5 actor helpers (found $defs)" \
  || fail "expected 5 actor helpers, found $defs"
[[ $with_set -eq $defs ]] && pass "every actor helper carries SET search_path ($with_set/$defs)" \
  || fail "only $with_set of $defs actor helpers carry SET search_path"

# A helper defined without the clause is the regression this file exists for.
if printf '%s\n' "$emitted" | awk '
  /^CREATE OR REPLACE FUNCTION public\.cms_actor/ { inblock = 1; has = 0; header = $0; next }
  inblock && /^  SET search_path = pg_catalog, public$/ { has = 1 }
  inblock && /^AS \$\$/ { if (!has) { print header; bad = 1 } inblock = 0 }
  END { exit bad ? 1 : 0 }
'; then
  pass "no helper reaches its body without the clause"
else
  fail "a helper is inlinable again — it will run once per row"
fi

# The shipped migration must be the emitted text, not a hand-typed copy that has drifted.
if [[ -r $MIG ]]; then
  pass "migration exists: $MIG"
  mig_defs=$(grep -c '^CREATE OR REPLACE FUNCTION public\.cms_actor' "$MIG")
  mig_set=$(grep -c '^  SET search_path = pg_catalog, public$' "$MIG")
  [[ $mig_defs -eq 5 ]] && pass "migration recreates 5 helpers" || fail "migration recreates $mig_defs helpers"
  [[ $mig_set -eq 5 ]] && pass "migration carries the clause on all 5" || fail "migration carries it on $mig_set/5"
  if grep -q 'CREATE POLICY\|DROP POLICY' "$MIG"; then
    fail "migration recreates policies — it would rewrite the whole policy set to change five functions"
  else
    pass "migration touches only the helpers"
  fi
else
  fail "migration missing: $MIG"
fi

printf '\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
