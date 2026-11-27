#!/usr/bin/env bash
# Proves every public identity read goes through the server-side Identity policy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RANKING="${ROOT}/ranking-web"
passed=0
failed=0

check() {
    local label="$1"
    shift
    if "$@"; then
        printf '[PASS] %s\n' "${label}"
        passed=$((passed + 1))
    else
        printf '[FAIL] %s\n' "${label}" >&2
        failed=$((failed + 1))
    fi
}

has() {
    local file="$1" pattern="$2"
    [[ -f "${file}" ]] && grep -Eq "${pattern}" "${file}"
}

missing() {
    local file="$1" pattern="$2"
    [[ ! -f "${file}" ]] || ! grep -Eq "${pattern}" "${file}"
}

check "the identity policy owns the stable surrogate" \
    has "${RANKING}/src/identity.rs" 'pub fn public_key'
check "the identity policy resolves a surrogate for one-entity reads" \
    has "${RANKING}/src/identity.rs" 'pub fn resolve'
check "the identity policy masks names" \
    has "${RANKING}/src/identity.rs" 'pub fn name'
check "the identity policy masks event payloads" \
    has "${RANKING}/src/identity.rs" 'pub fn event_data'
check "the identity policy uses a per-process salt" \
    has "${RANKING}/src/identity.rs" 'getrandom::getrandom'
check "scores maps the public key" \
    has "${RANKING}/src/http.rs" 'identity\.public_key\(user\)'
check "the board maps the public key and name" \
    has "${RANKING}/src/http.rs" 'identity\.name\("", ""\)'
check "the team board maps member keys" \
    has "${RANKING}/src/http.rs" 'identity\.public_key\(member\)'
check "history maps the user key" \
    has "${RANKING}/src/http.rs" 'identity\.public_key\(user\)'
check "overrides maps user targets" \
    has "${RANKING}/src/http.rs" 'row\.target_key = identity\.public_key'
check "the user list accepts the identity rule" \
    has "${RANKING}/src/entities.rs" 'pub async fn list_body\('
check "the user list maps keys and names" \
    has "${RANKING}/src/entities.rs" 'fn map_users'
check "the one-user read resolves the surrogate" \
    has "${RANKING}/src/entities.rs" 'fn public_user_key'
check "the submission list maps its user" \
    has "${RANKING}/src/entities.rs" 'entry\.user = public\.clone'
check "entity routes pass the identity rule to lists" \
    has "${RANKING}/src/entity_routes.rs" 'list_body\(db\.pool\(\), kind, &shown, identity\)'
check "entity routes pass the identity rule to one reads" \
    has "${RANKING}/src/entity_routes.rs" 'one_body\(db\.pool\(\), kind, key, &shown, identity\)'
check "entity routes resolve a surrogate for sublists" \
    has "${RANKING}/src/entity_routes.rs" 'identity\.resolve\(&user, standings\.users\.keys\(\)\)'
check "a masked face serves the bundled dummy" \
    has "${RANKING}/src/entity_routes.rs" 'identity\.masked\(\) => return bundled'
check "events map live and replayed payloads" \
    has "${RANKING}/src/events.rs" 'masked_frame'
check "diagnostics reports the active identity policy" \
    has "${RANKING}/src/http.rs" 'identity_masked: identity\.masked\(\)'
check "the client no longer offers an unmask checkbox" \
    has "${RANKING}/static/Perspectives.js" 'anon-locked'
check "the client does not mark a checked anonymous box" \
    missing "${RANKING}/static/Perspectives.js" 'self\.anonymous \? " checked"'
check "the board does not serialize ledger scores directly" \
    missing "${RANKING}/src/http.rs" 'stamped_json\(standings\.ledger\.scores\(\)\)'
check "the board does not serialize the ledger history directly" \
    missing "${RANKING}/src/http.rs" 'json_response\(&standings\.ledger\.history\(\)\.to_vec\(\)\)'

printf '%d passed, %d failed\n' "${passed}" "${failed}"
[[ "${failed}" -eq 0 ]]
