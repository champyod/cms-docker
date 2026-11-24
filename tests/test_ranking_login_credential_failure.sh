#!/usr/bin/env bash
# Static guard for WS-03: a malformed stored credential must take the same failure path as a
# wrong password, including the failure counter, and must not become a service refusal.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
submit="$root/ranking-web/src/login/submit.rs"

fail=0
pass=0
ok() { pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; fail=$((fail + 1)); }

grep -q 'Err(error) => {' "$submit" && ok || bad "malformed credential branch missing"
grep -q 'unusable stored credential' "$submit" && ok || bad "malformed credential is not logged"
grep -q 'return Ok(None)' "$submit" && ok || bad "malformed credential does not fall through to credentials"
! grep -q 'Err(error) => return Err(Refusal' "$submit" && ok || bad "malformed credential still becomes a service refusal"
grep -q 'record_failure(counter, Some(&account_key), &address_key, &facts)' "$submit" && ok || bad "credential failures do not record the counter"
grep -q '"/login?error=credentials"' "$submit" && ok || bad "the generic credentials redirect is missing"

printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
