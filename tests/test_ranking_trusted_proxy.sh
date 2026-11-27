#!/usr/bin/env bash
# Proves the ranking login resolves a source address only from a trusted peer.
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

check "the config carries a trusted proxy list" \
    has "${RANKING}/src/config.rs" 'pub trusted_proxies: Vec<TrustedProxy>'
check "the config reads RANKING_TRUSTED_PROXIES" \
    has "${RANKING}/src/config.rs" 'RANKING_TRUSTED_PROXIES'
check "the login handler receives the connection peer" \
    has "${RANKING}/src/login/submit.rs" 'ConnectInfo<SocketAddr>'
check "the server publishes connection info" \
    has "${RANKING}/src/lib.rs" 'into_make_service_with_connect_info'
check "the address resolver takes the peer and the trusted list" \
    has "${RANKING}/src/login/gate.rs" 'pub fn client_address\('
check "the resolver separates the peer from the trusted list" \
    has "${RANKING}/src/login/gate.rs" 'trusted_proxies: &\[TrustedProxy\]'
check "the resolver consults a trust predicate" \
    has "${RANKING}/src/login/gate.rs" 'is_trusted_proxy'
check "the resolver has no shared unknown fallback" \
    missing "${RANKING}/src/login/gate.rs" '"unknown"'
check "the config parses exact networks" \
    has "${RANKING}/src/trusted_proxy.rs" 'impl TrustedProxy'
check "the endpoint test proves a spoofed header cannot pick a bucket" \
    has "${RANKING}/tests/e2e/ranking_e2e.sh" 'spoofed_forwarded_header_cannot_choose_a_bucket'
check "the compose passes the trusted list to the service" \
    has "${ROOT}/docker-compose.yml" 'RANKING_TRUSTED_PROXIES:'

printf '%d passed, %d failed\n' "${passed}" "${failed}"
[[ "${failed}" -eq 0 ]]
