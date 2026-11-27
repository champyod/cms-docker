#!/usr/bin/env bash
# Proves every session-cookie surface uses the same secure-by-default policy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

compose_has_four_secure_bindings() {
    [[ "$(grep -c 'COOKIE_SECURE: ${COOKIE_SECURE:-true}' "${ROOT}/docker-compose.yml")" -ge 4 ]]
}

check "all four surfaces receive the shared secure setting" \
    compose_has_four_secure_bindings
check "the tracked config default is secure" \
    has "${ROOT}/config.toml.example" '^COOKIE_SECURE = true'
check "the config-spec default is secure" \
    has "${ROOT}/scripts/__update_engine.sh" 'COOKIE_SECURE\|bool\|\|true'
check "the ranking config is secure by default" \
    has "${ROOT}/ranking-web/src/config.rs" 'cookie_secure: true'
check "the ranking config reads COOKIE_SECURE" \
    has "${ROOT}/ranking-web/src/config.rs" 'vars.get\("COOKIE_SECURE"\)'
check "ranking login uses the configured secure value" \
    has "${ROOT}/ranking-web/src/login/submit.rs" 'set_cookie\(&token, state.config\(\).cookie_secure\)'
check "ranking logout uses the same secure value" \
    has "${ROOT}/ranking-web/src/login/logout.rs" 'clear_cookie\(state.config\(\).cookie_secure\)'
check "ranking cookies keep HttpOnly and SameSite=Lax" \
    has "${ROOT}/ranking-web/src/auth/session.rs" 'HttpOnly; SameSite=Lax'
check "the panel default is secure unless explicitly overridden" \
    has "${ROOT}/admin-panel/src/lib/cookie-security.ts" '!INSECURE_VALUES.has'
check "the panel uses the shared secure resolver" \
    has "${ROOT}/admin-panel/src/lib/auth.ts" 'resolveSecureCookie\(process.env.COOKIE_SECURE\)'
check "the Python cookie helper is secure by default" \
    has "${ROOT}/src/cmscommon/cookies.py" 'os.environ.get\("COOKIE_SECURE", "true"\)'
check "classic admin uses the shared cookie attributes" \
    has "${ROOT}/src/cms/server/admin/authentication.py" '\*\*session_cookie_attributes\(\)'
check "contest issue and clear use the shared cookie attributes" \
    has "${ROOT}/src/cms/server/contest/handlers/contest.py" '\*\*session_cookie_attributes\(\)'
check "the endpoint test proves the explicit HTTP attributes" \
    has "${ROOT}/ranking-web/tests/e2e/ranking_e2e.sh" 'console_cookie_attributes_match_the_http_override'
check "ranking login no longer hardcodes insecure cookies" \
    missing "${ROOT}/ranking-web/src/login/submit.rs" 'set_cookie\(&token, false\)'
check "the panel no longer defaults Secure off" \
    missing "${ROOT}/admin-panel/src/lib/auth.ts" "process.env.COOKIE_SECURE === 'true'"

printf '%d passed, %d failed\n' "${passed}" "${failed}"
[[ "${failed}" -eq 0 ]]
