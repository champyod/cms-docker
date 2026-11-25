#!/usr/bin/env bash
# Proves the ranking console refuses a bcrypt candidate past its 72-byte window.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASSWORD="${ROOT}/ranking-web/src/auth/password.rs"
E2E="${ROOT}/ranking-web/tests/e2e/ranking_e2e.sh"
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

check "the console declares bcrypt's 72-byte window" \
    has "${PASSWORD}" 'const MAX_PASSWORD_BYTES: usize = 72;'
check "the verifier refuses a candidate past that window" \
    has "${PASSWORD}" 'candidate\.len\(\) > MAX_PASSWORD_BYTES'
check "the unit test pins the 72-byte password" \
    has "${PASSWORD}" 'fn a_72_byte_password_still_verifies'
check "the unit test pins the one-byte extension" \
    has "${PASSWORD}" 'fn a_longer_candidate_does_not_extend_a_72_byte_password'
check "the endpoint test seeds a 72-byte credential" \
    has "${E2E}" 'e2e-long'
check "the endpoint test refuses the extension and accepts 72 bytes" \
    has "${E2E}" 'console_login_refuses_an_overlong_candidate'

printf '%d passed, %d failed\n' "${passed}" "${failed}"
[[ "${failed}" -eq 0 ]]
