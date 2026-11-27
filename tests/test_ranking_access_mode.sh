#!/usr/bin/env bash
# Proves access_mode has one closed parser and one database invariant.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RANKING="${ROOT}/ranking-web"
PANEL="${ROOT}/admin-panel"
MIGRATION="${PANEL}/prisma/migrations/20261125150000_ranking_access_mode_check/migration.sql"
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

check "the ranking side has a closed access-mode parser" \
    has "${RANKING}/src/access_mode.rs" 'pub fn parse\(value: &str\)'
check "an unknown stored value falls back to protected" \
    has "${RANKING}/src/access_mode.rs" 'unwrap_or\(Self::Protected\)'
check "the gate asks the parser, not a raw string comparison" \
    has "${RANKING}/src/login/gate.rs" 'access_mode\(\)\.is_protected\(\)'
check "the panel reads only exact public as public" \
    has "${PANEL}/src/app/actions/rankingAppearance.ts" 'row\.access_mode === ACCESS_MODE_PUBLIC'
check "the panel rejects an unknown access mode at write time" \
    has "${PANEL}/src/app/actions/rankingAppearance.ts" 'accessMode must be public or protected'
check "the migration normalises before it constrains" \
    has "${MIGRATION}" "SET \"access_mode\" = 'protected'"
check "the database has the named check constraint" \
    has "${MIGRATION}" 'ranking_settings_access_mode_check'
check "the endpoint test proves the database refuses an unknown mode" \
    has "${RANKING}/tests/e2e/ranking_e2e.sh" 'access_mode_constraint_rejects_unknown'

printf '%d passed, %d failed\n' "${passed}" "${failed}"
[[ "${failed}" -eq 0 ]]
