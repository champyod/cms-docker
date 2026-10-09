#!/usr/bin/env bash
# Full-stack acceptance rehearsal for the ranking service.
#
# WHY this is a script and not a cargo test: it needs a running PostgreSQL that carries
# the ranking tables, the vendored page on disk, and a built release binary. None of
# those belong in a unit-test runner, and the parts that do not need them are already
# covered by tests/process_e2e.rs.
#
# Usage:
#   RANKING_E2E_DATABASE_URL=postgresql://cmsuser:pw@127.0.0.1:5432/cmsdb \
#     bash tools/cms-ranking/tests/e2e/ranking_e2e.sh
#
# Every seeded row is fixture data read from seed.json, never operator input.

set -euo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CRATE="$(cd "${HERE}/../.." && pwd)"
readonly REPO="$(cd "${CRATE}/../.." && pwd)"
readonly PARITY="${CRATE}/tests/fixtures/parity"
readonly DATABASE_URL="${RANKING_E2E_DATABASE_URL:?set RANKING_E2E_DATABASE_URL to a database carrying the ranking tables}"
readonly BIN="${RANKING_E2E_BINARY:-${CRATE}/target/release/cms-ranking}"
readonly PORT="${RANKING_E2E_PORT:-18890}"
readonly BASE="http://127.0.0.1:${PORT}"
readonly LOG="$(mktemp)"

fail() { printf "[FAIL] %s\n" "$1" >&2; exit 1; }
pass() { printf "[PASS] %s\n" "$1"; }

cleanup() {
    if [[ -n "${SERVICE_PID:-}" ]]; then
        kill "${SERVICE_PID}" 2>/dev/null || true
        wait "${SERVICE_PID}" 2>/dev/null || true
    fi
    rm -f "${LOG}"
}
trap cleanup EXIT

require_tools() {
    for tool in psql curl python3; do
        command -v "${tool}" >/dev/null 2>&1 || fail "missing ${tool}"
    done
    [[ -x "${BIN}" ]] || fail "build it first: cargo build --release (looked for ${BIN})"
    [[ -d "${REPO}/src/cmsranking/static" ]] || fail "the vendored page is not in this checkout"
}

apply_migrations() {
    local migration
    for migration in \
        20261009150000_ranking_tables \
        20261009150100_ranking_tables_rls \
        20261009160000_ranking_notify \
        20261009170000_ranking_console_users \
        20261009170100_ranking_console_users_rls; do
        psql "${DATABASE_URL}" -q -f "${REPO}/admin-panel/prisma/migrations/${migration}/migration.sql" \
            >/dev/null || fail "migration ${migration} did not apply"
    done
    pass "the five ranking migrations apply in order"
}

seed_rows() {
    python3 - "${PARITY}/seed.json" <<'PY' | psql "${DATABASE_URL}" -q >/dev/null
import json, sys

seed = json.load(open(sys.argv[1], encoding="utf-8"))
entities = seed["entities"]
for key, body in entities["contests"].items():
    print(f"INSERT INTO ranking_contests (key,name,begin,\"end\",score_precision) VALUES ('{key}','{body['name']}',{body['begin']},{body['end']},{body['score_precision']}) ON CONFLICT (key) DO NOTHING;")
for key, body in entities["tasks"].items():
    print(f"INSERT INTO ranking_tasks (key,name,short_name,contest,max_score,score_precision,extra_headers,display_order,score_mode) VALUES ('{key}','{body['name']}','{body['short_name']}','{body['contest']}',{body['max_score']},{body['score_precision']},'[]'::jsonb,{body['order']},'{body['score_mode']}') ON CONFLICT (key) DO NOTHING;")
for key, body in entities["teams"].items():
    print(f"INSERT INTO ranking_teams (key,name) VALUES ('{key}','{body['name']}') ON CONFLICT (key) DO NOTHING;")
for key, body in entities["users"].items():
    team = "NULL" if body["team"] is None else f"'{body['team']}'"
    print(f"INSERT INTO ranking_users (key,f_name,l_name,team) VALUES ('{key}','{body['f_name']}','{body['l_name']}',{team}) ON CONFLICT (key) DO NOTHING;")
for key, body in entities["submissions"].items():
    print(f"INSERT INTO ranking_submissions (key,\"user\",task,time) VALUES ('{key}','{body['user']}','{body['task']}',{body['time']}) ON CONFLICT (key) DO NOTHING;")
for key, body in entities["subchanges"].items():
    print(f"INSERT INTO ranking_subchanges (key,submission,time,score) VALUES ('{key}','{body['submission']}',{body['time']},{body['score']}) ON CONFLICT (key) DO NOTHING;")
PY
    pass "the fixture projection is seeded"
}

start_service() {
    RANKING_BIND_ADDRESS="127.0.0.1:${PORT}" \
        DATABASE_URL="${DATABASE_URL}" \
        RANKING_STATIC_DIR="${REPO}/src/cmsranking/static" \
        CMS_CREDITS_FILE="${REPO}/credits.json" \
        "${BIN}" >"${LOG}" 2>&1 &
    SERVICE_PID=$!
    local attempt
    for attempt in $(seq 1 40); do
        if curl -fsS "${BASE}/healthz" >/dev/null 2>&1; then
            pass "the service answers /healthz"
            return 0
        fi
        kill -0 "${SERVICE_PID}" 2>/dev/null || fail "the service exited: $(cat "${LOG}")"
        sleep 0.25
    done
    fail "the service never became ready: $(cat "${LOG}")"
}

compare_to_oracle() {
    local route="$1" field="$2"
    curl -fsS "${BASE}${route}" | python3 -c \
        "import json,sys; served=json.load(sys.stdin); expected=json.load(open(sys.argv[1]))[sys.argv[2]]; sys.exit(0 if served==expected else 1)" \
        "${PARITY}/scoring-oracle.json" "${field}" \
        || fail "${route} does not match the Python scorer"
    pass "${route} matches the values the Python scorer produced"
}

events_follow_a_write() {
    (timeout 10 curl -sS -N "${BASE}/events" >"${LOG}.events" || true) &
    local reader=$!
    sleep 1
    psql "${DATABASE_URL}" -q -c \
        "INSERT INTO ranking_teams (key,name) VALUES ('e2e_probe','Probe') ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name" \
        >/dev/null
    wait "${reader}" || true
    grep -q "event:team" "${LOG}.events" || fail "no live event reached an open stream"
    rm -f "${LOG}.events"
    pass "a write reaches an open event stream"
}

# A console account, seeded as plaintext instead of a hash: the password format supports
# both, seeding a hash would need a hashing tool this script does not require, and the
# plaintext branch is the one a fresh deployment starts with.
seed_console_user() {
    psql "${DATABASE_URL}" -q -c "DELETE FROM ranking_console_users WHERE username = 'e2e'" >/dev/null
    psql "${DATABASE_URL}" -q -c "INSERT INTO ranking_console_users (username, password) VALUES ('e2e', 'plaintext:e2e-secret')" >/dev/null
    pass "the console account is seeded"
}

console_login() {
    local jar code
    jar="$(mktemp)"
    code="$(curl -sS -o /dev/null -w "%{http_code}" -c "${jar}" \
        -d "username=e2e" -d "password=e2e-secret" "${BASE}/login")"
    [[ "${code}" == "303" || "${code}" == "307" ]] || fail "a correct password should be accepted, got ${code}"
    grep -q ranking_session "${jar}" || fail "an accepted login set no session cookie"
    code="$(curl -sS -o /dev/null -w "%{http_code}" -b "${jar}" "${BASE}/scores")"
    [[ "${code}" == "200" ]] || fail "the session should open the scoreboard, got ${code}"
    rm -f "${jar}"
    pass "a seeded console account signs in and reaches the scoreboard"
}

console_login_refuses_a_wrong_password() {
    local headers
    headers="$(curl -sS -D - -o /dev/null -d "username=e2e" -d "password=wrong" "${BASE}/login")"
    if grep -qi "^set-cookie:.*ranking_session" <<<"${headers}"; then
        fail "a refused login handed out a session"
    fi
    pass "a wrong password is refused and sets no session"
}

protected_mode_redirects() {
    psql "${DATABASE_URL}" -q -c \
        "INSERT INTO ranking_settings (id, access_mode) VALUES (1, 'protected') ON CONFLICT (id) DO UPDATE SET access_mode = 'protected'" \
        >/dev/null
    local code
    code="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/")"
    [[ "${code}" == "303" || "${code}" == "307" ]] || fail "expected a redirect to the sign-in page, got ${code}"
    console_login
    console_login_refuses_a_wrong_password
    psql "${DATABASE_URL}" -q -c "UPDATE ranking_settings SET access_mode = 'public' WHERE id = 1" >/dev/null
    pass "protected mode sends an anonymous visitor to the sign-in page"
}

main() {
    require_tools
    apply_migrations
    seed_rows
    start_service
    compare_to_oracle "/scores" "scores"
    compare_to_oracle "/history" "history"
    events_follow_a_write
    seed_console_user
    protected_mode_redirects
    printf "\nacceptance rehearsal passed\n"
}

main "$@"
