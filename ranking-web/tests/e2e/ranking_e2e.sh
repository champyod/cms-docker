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
#   RANKING_E2E_REDIS_URL=redis://127.0.0.1:6379 \
#     bash ranking-web/tests/e2e/ranking_e2e.sh
#
# Both are required: the database carries the ranking tables this script applies, and
# the console refuses every login when the Redis holding the failure counters is absent.
#
# Every seeded row is fixture data read from seed.json, never operator input.

set -euo pipefail

readonly HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CRATE="$(cd "${HERE}/../.." && pwd)"
# The crate sits one level below the repository root (ranking-web/), so the root is
# its parent — the ../.. this used to be, when the crate lived at tools/cms-ranking.
readonly REPO="$(cd "${CRATE}/.." && pwd)"
readonly PARITY="${CRATE}/tests/fixtures/parity"
readonly DATABASE_URL="${RANKING_E2E_DATABASE_URL:?set RANKING_E2E_DATABASE_URL to a database carrying the ranking tables}"
# Exported, not re-assigned on the command line: the service reads DATABASE_URL from
# its environment, but `DATABASE_URL=... cmd` against a readonly name is a fatal
# "readonly variable" in bash, which stopped the service from starting at all.
export DATABASE_URL
readonly REDIS_URL="${RANKING_E2E_REDIS_URL:?set RANKING_E2E_REDIS_URL to the Redis the console counts failures in}"
# The console signs its cookie with this, so an absent value refuses the login route
# rather than accepting a weaker one. It is a fixture rather than a credential: the run
# mints it, uses it and discards it inside one rehearsal.
readonly SESSION_SECRET="${RANKING_E2E_SESSION_SECRET:-ranking-e2e-session-secret}"
readonly BIN="${RANKING_E2E_BINARY:-${CRATE}/target/release/cms-ranking}"
readonly PORT="${RANKING_E2E_PORT:-18890}"
readonly BASE="http://127.0.0.1:${PORT}"
readonly LOG="$(mktemp)"
readonly WORK="$(mktemp -d)"
SERVICE_TRUSTED_PROXIES="127.0.0.1/32"
SERVICE_REDIS_URL="${REDIS_URL}"

# The surface assertions live in their own file so this driver stays readable.
# shellcheck source=surface_checks.sh
source "${HERE}/surface_checks.sh"

fail() { printf "[FAIL] %s\n" "$1" >&2; exit 1; }
pass() { printf "[PASS] %s\n" "$1"; }

cleanup() {
    if [[ -n "${SERVICE_PID:-}" ]]; then
        kill "${SERVICE_PID}" 2>/dev/null || true
        wait "${SERVICE_PID}" 2>/dev/null || true
    fi
    rm -f "${LOG}"
    rm -rf "${WORK}"
}
trap cleanup EXIT

stop_service() {
    if [[ -n "${SERVICE_PID:-}" ]]; then
        kill "${SERVICE_PID}" 2>/dev/null || true
        wait "${SERVICE_PID}" 2>/dev/null || true
        SERVICE_PID=""
    fi
}

redis_url_with_database() {
    python3 - "$1" "$2" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit

parts = urlsplit(sys.argv[1])
print(urlunsplit((parts.scheme, parts.netloc, f"/{sys.argv[2]}", parts.query, parts.fragment)))
PY
}

flush_redis_database() {
    python3 - "$1" <<'PY'
import socket
import sys
from urllib.parse import unquote, urlsplit

parts = urlsplit(sys.argv[1])
database = (parts.path or "/0").strip("/") or "0"
with socket.create_connection((parts.hostname or "127.0.0.1", parts.port or 6379), timeout=5) as connection:
    def command(*arguments):
        payload = f"*{len(arguments)}\r\n".encode()
        for argument in arguments:
            data = str(argument).encode()
            payload += f"${len(data)}\r\n".encode() + data + b"\r\n"
        connection.sendall(payload)
        reply = connection.recv(4096)
        if not reply.startswith(b"+"):
            raise SystemExit(f"redis refused {arguments[0]}: {reply!r}")

    if parts.password:
        command("AUTH", unquote(parts.username or ""), unquote(parts.password))
    command("SELECT", database)
    command("FLUSHDB")
PY
}

require_tools() {
    for tool in psql curl python3; do
        command -v "${tool}" >/dev/null 2>&1 || fail "missing ${tool}"
    done
    [[ -x "${BIN}" ]] || fail "build it first: cargo build --release (looked for ${BIN})"
    [[ -d "${REPO}/ranking-web/static" ]] || fail "the vendored page is not in this checkout"
}

# The strict apply lives in scripts/__apply_ranking_migrations.sh, which CI calls too: this
# rehearsal and the CI job must judge the ranking schema identically. It used to run psql here
# without ON_ERROR_STOP, so psql exited 0 after a failed statement and the `|| fail` below could
# never fire — the [PASS] was printed for a schema that had not fully applied.
apply_migrations() {
    bash "${REPO}/scripts/__apply_ranking_migrations.sh" "${DATABASE_URL}" "${REPO}" ||
        fail "the ranking migrations did not all apply"
}

seed_rows() {
    python3 - "${PARITY}/seed.json" <<'PY' | psql "${DATABASE_URL}" -q >/dev/null
import json, sys

seed = json.load(open(sys.argv[1], encoding="utf-8"))
entities = seed["entities"]
# The board draws what the config names and nothing else (item R1), so each seeded contest
# carries the CMS id its rows are filed under, and a config row shows it. Without that row the
# rehearsal would drive a board that deliberately draws no columns at all.
contest_ids = {key: index + 1 for index, key in enumerate(entities["contests"])}
for key, body in entities["contests"].items():
    print(f"INSERT INTO ranking_contests (key,name,begin,\"end\",score_precision,contest_id) VALUES ('{key}','{body['name']}',{body['begin']},{body['end']},{body['score_precision']},{contest_ids[key]}) ON CONFLICT (key) DO NOTHING;")
for key, body in entities["tasks"].items():
    print(f"INSERT INTO ranking_tasks (key,name,short_name,contest,contest_id,max_score,score_precision,extra_headers,display_order,score_mode) VALUES ('{key}','{body['name']}','{body['short_name']}','{body['contest']}',{contest_ids[body['contest']]},{body['max_score']},{body['score_precision']},'[]'::jsonb,{body['order']},'{body['score_mode']}') ON CONFLICT (key) DO NOTHING;")
for key in entities["contests"]:
    print(f"INSERT INTO ranking_config (target_kind,target_key,reason,active) VALUES ('contest','{contest_ids[key]}','the acceptance rehearsal shows exactly the contest it seeded',true);")
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
        RANKING_REDIS_URL="${SERVICE_REDIS_URL}" \
        RANKING_TRUSTED_PROXIES="${SERVICE_TRUSTED_PROXIES}" \
        COOKIE_SECURE=false \
        RANKING_SESSION_SECRET="${SESSION_SECRET}" \
        RANKING_STATIC_DIR="${REPO}/ranking-web/static" \
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
    local key
    key="$(python3 -c "import json,sys;print(next(iter(json.load(open(sys.argv[1]))['entities']['contests'])))" \
        "${PARITY}/seed.json")" || fail "seed.json carries no contest to touch"
    (timeout 10 curl -sS -N "${BASE}/events" >"${LOG}.events" || true) &
    local reader=$!
    sleep 1
    # The probe writes a contest the seeded config shows. The feed announces an entity only
    # when the board draws it (item R1), so a row outside the shown set — the probe used to be
    # a members-less team — would test the scope rather than the stream and report no event
    # even though live delivery works.
    psql "${DATABASE_URL}" -q -c \
        "UPDATE ranking_contests SET name = name WHERE key = '${key}'" \
        >/dev/null
    wait "${reader}" || true
    grep -q "event:contest" "${LOG}.events" || fail "no live event reached an open stream"
    rm -f "${LOG}.events"
    pass "a write reaches an open event stream"
}

# The console authenticates a panel admin holding ranking:read, seeded as plaintext
# instead of a hash so the rehearsal needs no hashing tool. A second admin carries the
# same password but no group, so the permission gate is exercised without confirming it.
prepare_console_schema() {
    # The console reads the panel's own tables, which the CMS base schema creates and the
    # ranking migrations do not. This rehearsal never runs cms-init, so it carries the five
    # it needs, declared to match the Prisma models it authenticates through.
    psql "${DATABASE_URL}" -q >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY, name VARCHAR NOT NULL, username VARCHAR NOT NULL UNIQUE,
    authentication VARCHAR NOT NULL, enabled BOOLEAN NOT NULL, last_login_at TIMESTAMP(3));
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY, key VARCHAR NOT NULL UNIQUE, module VARCHAR NOT NULL,
    verb VARCHAR NOT NULL, description VARCHAR);
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY, name VARCHAR NOT NULL UNIQUE, description VARCHAR,
    is_seeded BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS group_permissions (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE (group_id, permission_id));
CREATE TABLE IF NOT EXISTS admin_permission_overrides (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    effect VARCHAR NOT NULL, reason VARCHAR, UNIQUE (admin_id, permission_id));
CREATE TABLE IF NOT EXISTS admin_groups (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    UNIQUE (admin_id, group_id));
SQL
}

seed_console_admin() {
    psql "${DATABASE_URL}" -q >/dev/null <<'SQL'
DELETE FROM admins WHERE username IN ('e2e', 'e2e-noperm', 'e2e-bad', 'e2e-long');
INSERT INTO admins (name, username, authentication, enabled) VALUES
    ('E2E Operator', 'e2e', 'bcrypt:$2b$10$dNhGvAUxNK3y0uOSw/CuL.xpMG2l/TqeUDGVGhNgFHFPJ6VUIH4Gu', true),
    ('E2E No Permission', 'e2e-noperm', 'bcrypt:$2b$10$dNhGvAUxNK3y0uOSw/CuL.xpMG2l/TqeUDGVGhNgFHFPJ6VUIH4Gu', true),
    ('E2E Malformed Credential', 'e2e-bad', 'plaintext:not-a-real-password', true),
    ('E2E Long Password', 'e2e-long', 'bcrypt:$2b$10$vBEmh6.imiNSHUTccz7SbOzbnc3q22/kjtuAju9pWH7E2dcuDKEW2', true);
INSERT INTO permissions (key, module, verb)
    VALUES ('ranking:read', 'ranking', 'read') ON CONFLICT (key) DO NOTHING;
INSERT INTO groups (name) VALUES ('e2e-ranking') ON CONFLICT (name) DO NOTHING;
INSERT INTO group_permissions (group_id, permission_id)
    SELECT g.id, p.id FROM groups g JOIN permissions p ON p.key = 'ranking:read'
    WHERE g.name = 'e2e-ranking' ON CONFLICT (group_id, permission_id) DO NOTHING;
INSERT INTO admin_groups (admin_id, group_id)
    SELECT a.id, g.id FROM admins a JOIN groups g ON g.name = 'e2e-ranking'
    WHERE a.username IN ('e2e', 'e2e-long') ON CONFLICT (admin_id, group_id) DO NOTHING;
SQL
    pass "the console admin and its ranking:read group are seeded"
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
    pass "a seeded admin signs in and reaches the scoreboard"
}

console_login_refuses_a_wrong_password() {
    local headers
    headers="$(curl -sS -D - -o /dev/null -d "username=e2e" -d "password=wrong" "${BASE}/login")"
    if grep -qi "^set-cookie:.*ranking_session" <<<"${headers}"; then
        fail "a refused login handed out a session"
    fi
    pass "a wrong password is refused and sets no session"
}

console_login_refuses_an_admin_without_the_key() {
    local headers
    headers="$(curl -sS -D - -o /dev/null -d "username=e2e-noperm" -d "password=e2e-secret" "${BASE}/login")"
    if grep -qi "^set-cookie:.*ranking_session" <<<"${headers}"; then
        fail "an admin without ranking:read was handed a session"
    fi
    pass "an admin without ranking:read is refused and sets no session"
}

console_login_treats_a_malformed_credential_as_a_credential_failure() {
    local ip="198.51.100.203" code
    for _ in 1 2 3 4 5; do
        code="$(curl -sS -o /dev/null -w "%{http_code}" -H "X-Forwarded-For: ${ip}" \
            -d "username=e2e-bad" -d "password=***" "${BASE}/login")"
        [[ "${code}" == "303" || "${code}" == "307" ]] ||
            fail "a malformed stored credential should look like a wrong password, got ${code}"
    done
    # The malformed attempts must feed the address counter; five of them lock the source.
    code="$(curl -sS -o /dev/null -w "%{http_code}" -H "X-Forwarded-For: ${ip}" \
        -d "username=e2e" -d "password=***" "${BASE}/login")"
    [[ "${code}" == "429" ]] ||
        fail "malformed credentials did not count toward the source lockout, got ${code}"
    pass "a malformed credential is counted and cannot confirm a username"
}

console_cookie_attributes_match_the_http_override() {
    local long headers
    long="$(python3 -c 'print("x" * 72)')"
    headers="$(curl -sS -D - -o /dev/null -H "X-Forwarded-For: 198.51.100.209" \
        -d "username=e2e-long" --data-urlencode "password=${long}" "${BASE}/login")"
    grep -qi '^set-cookie:.*HttpOnly' <<<"${headers}" || fail "the session cookie is not HttpOnly"
    grep -qi '^set-cookie:.*SameSite=Lax' <<<"${headers}" || fail "the session cookie is not SameSite=Lax"
    if grep -qi '^set-cookie:.*Secure' <<<"${headers}"; then
        fail "the explicit local HTTP override still emitted Secure"
    fi
    pass "the session cookie keeps HttpOnly and SameSite=Lax under the explicit HTTP override"
}

console_login_refuses_an_overlong_candidate() {
    local long over headers jar code
    long="$(python3 -c 'print("x" * 72)')"
    over="$(python3 -c 'print("x" * 73)')"
    headers="$(curl -sS -D - -o /dev/null -H "X-Forwarded-For: 198.51.100.208" \
        -d "username=e2e-long" --data-urlencode "password=${over}" "${BASE}/login")"
    if grep -qi "^set-cookie:.*ranking_session" <<<"${headers}"; then
        fail "a candidate one byte over bcrypt's limit authenticated the account"
    fi
    jar="$(mktemp)"
    code="$(curl -sS -o /dev/null -w "%{http_code}" -c "${jar}" \
        -H "X-Forwarded-For: 198.51.100.208" -d "username=e2e-long" \
        --data-urlencode "password=${long}" "${BASE}/login")"
    [[ "${code}" == "303" || "${code}" == "307" ]] || fail "the 72-byte password should be accepted, got ${code}"
    grep -q ranking_session "${jar}" || fail "the 72-byte password set no session"
    rm -f "${jar}"
    pass "a candidate over 72 bytes is refused while the 72-byte password still signs in"
}

console_login_rejects_an_oversized_username() {
    local ip="198.51.100.204" code long
    long="$(python3 -c 'print("a" * 4096)')"
    for _ in 1 2 3 4 5; do
        code="$(curl -sS -o /dev/null -w "%{http_code}" -H "X-Forwarded-For: ${ip}" \
            --data-urlencode "username=${long}" -d "password=wrong" "${BASE}/login")"
        [[ "${code}" == "303" || "${code}" == "307" ]] ||
            fail "an oversized username should be a generic refusal, got ${code}"
    done
    code="$(curl -sS -o /dev/null -w "%{http_code}" -H "X-Forwarded-For: ${ip}" \
        -d "username=e2e" -d "password=wrong" "${BASE}/login")"
    [[ "${code}" == "429" ]] ||
        fail "oversized usernames did not count toward the source lockout, got ${code}"
    grep -q 'refused oversized username' "${LOG}" || fail "oversized username left no log signal"
    pass "an oversized username is refused, logged and counted without a database lookup"
}

spoofed_forwarded_header_cannot_choose_a_bucket() {
    local attempt code
    for attempt in 1 2 3 4 5; do
        code="$(curl -sS -o /dev/null -w "%{http_code}" \
            -H "X-Forwarded-For: 203.0.113.${attempt}" \
            -d "username=e2e" -d "password=wrong" "${BASE}/login")"
        [[ "${code}" == "303" || "${code}" == "307" ]] ||
            fail "a wrong password should be a generic refusal, got ${code}"
    done
    code="$(curl -sS -o /dev/null -w "%{http_code}" \
        -H "X-Forwarded-For: 203.0.113.250" \
        -d "username=e2e" -d "password=wrong" "${BASE}/login")"
    [[ "${code}" == "429" ]] ||
        fail "an untrusted caller changed its lockout bucket with a header, got ${code}"
    pass "a spoofed forwarded header cannot choose a lockout bucket"
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
    console_login_refuses_an_admin_without_the_key
    psql "${DATABASE_URL}" -q -c "UPDATE ranking_settings SET access_mode = 'public' WHERE id = 1" >/dev/null
    pass "protected mode sends an anonymous visitor to the sign-in page"
}

access_mode_constraint_rejects_unknown() {
    local output
    if output="$(psql "${DATABASE_URL}" -q -v ON_ERROR_STOP=1 \
        -c "UPDATE ranking_settings SET access_mode = 'weird' WHERE id = 1" 2>&1)"; then
        fail "the database accepted an unknown access mode"
    fi
    grep -q 'ranking_settings_access_mode_check' <<<"${output}" ||
        fail "the unknown access mode was refused by something other than its check constraint"
    pass "the database refuses an access mode outside public and protected"
}

main() {
    require_tools
    prepare_console_schema
    apply_migrations
    seed_rows
    seed_console_admin
    flush_redis_database "$(redis_url_with_database "${REDIS_URL}" 15)"
    SERVICE_TRUSTED_PROXIES="192.0.2.1/32"
    SERVICE_REDIS_URL="$(redis_url_with_database "${REDIS_URL}" 15)"
    start_service
    spoofed_forwarded_header_cannot_choose_a_bucket
    stop_service
    SERVICE_TRUSTED_PROXIES="127.0.0.1/32"
    SERVICE_REDIS_URL="${REDIS_URL}"
    start_service
    compare_to_oracle "/scores" "scores"
    compare_to_oracle "/history" "history"
    board_carries_the_overrides
    entity_lists_carry_the_seeded_values
    task_single_keeps_the_python_byte_style
    public_config_is_exactly_two_keys
    credits_nests_licence_project_and_surface
    timestamps_land_where_python_put_them
    image_routes_never_answer_a_404
    unknown_entity_key_is_a_404
    events_refuse_a_client_that_excludes_the_stream
    events_follow_a_write
    a_score_write_publishes_a_board_delta
    a_stale_event_id_is_answered_with_a_reinit
    console_login_treats_a_malformed_credential_as_a_credential_failure
    console_login_refuses_an_overlong_candidate
    console_cookie_attributes_match_the_http_override
    console_login_rejects_an_oversized_username
    protected_mode_redirects
    access_mode_constraint_rejects_unknown
    printf "\nacceptance rehearsal passed\n"
}

main "$@"
