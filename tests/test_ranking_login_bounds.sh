#!/usr/bin/env bash
# Static guard for WS-04: an oversized username must not become a Redis key, and the
# panel must recover the display name from the bounded metadata beside a hashed key.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lockout="$root/ranking-web/src/auth/lockout.rs"
submit="$root/ranking-web/src/login/submit.rs"
counter="$root/ranking-web/src/auth/counter.rs"
panel="$root/admin-panel/src/lib/login-lockouts.ts"
namespaces="$root/admin-panel/src/lib/lockout-namespaces.ts"

fail=0
pass=0
ok() { pass=$((pass + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; fail=$((fail + 1)); }
has() { if grep -q "$2" "$1"; then ok; else bad "$3"; fi; }

has "$lockout" 'MAX_USERNAME_BYTES: usize = 128' "username cap missing"
has "$lockout" 'Sha256::digest' "account key is not hashed"
has "$lockout" 'metadata_key_for' "metadata key helper missing"
has "$submit" 'username_within_limit' "submit does not reject oversized usernames"
has "$submit" 'record_identity' "submit does not write display metadata"
has "$counter" 'record_identity' "counter cannot store display metadata"
has "$panel" 'loadRankingIdentities' "panel cannot resolve hashed account names"
has "$namespaces" 'rankingMetadataKeyFor' "panel metadata key helper missing"
if grep -q 'format!("{NAMESPACE}{username}|' "$lockout"; then
    bad "raw username is still embedded in the counter key"
else
    ok
fi

printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
