#!/usr/bin/env bash
# Proves a board row belongs to one contest: the override fold keeps contest_id, the
# ledger keys rows by (contest, user), and the page scopes its override lookups.
#
# WHY a static guard beside the live tests: the two live suites need PostgreSQL, so a
# regression that drops the contest from one of the four layers below would pass CI on a
# machine with no database. These checks read the sources directly and fail on the
# regression even without one.
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

has_fixed() {
    local file="$1" text="$2"
    [[ -f "${file}" ]] && grep -Fq "${text}" "${file}"
}

missing() {
    local file="$1" pattern="$2"
    [[ ! -f "${file}" ]] || ! grep -Eq "${pattern}" "${file}"
}

check "the override row carries the contest it was filed under" \
    has "${RANKING}/src/overrides.rs" 'pub contest_id: i32'
check "the fold keeps a per-contest scope for every user and team action" \
    has "${RANKING}/src/overrides.rs" 'pub struct ContestScope'
check "the fold records each row into its own contest scope" \
    has "${RANKING}/src/overrides.rs" 'self\.scopes\.insert\(row\.contest_id, scope\)'
check "a contest with no override row reads an empty scope" \
    has "${RANKING}/src/overrides.rs" 'pub fn scope\(&self, contest_id: i32\)'
check "the override read selects the contest id" \
    has "${RANKING}/src/store.rs" 'payload, contest_id FROM ranking_overrides'
check "the hidden tombstone keeps the contest it was filed in" \
    has "${RANKING}/src/store.rs" 'SELECT key, contest_id FROM ranking_hidden'
check "the task mode carries the contest it belongs to" \
    has "${RANKING}/src/score.rs" 'pub contest_id: i32'
check "the board row carries its contest" \
    has "${RANKING}/src/board.rs" 'pub contest_id: i32'
check "the ledger keys rows by contest and user" \
    has "${RANKING}/src/scoring.rs" 'BTreeMap<\(i32, String\), BoardRow>'
check "the ledger reads the scope of the task's own contest" \
    has "${RANKING}/src/scoring.rs" 'overrides\.scope\(contest_id\)'
check "the replay reads the freeze of the change's own contest" \
    has "${RANKING}/src/scoring.rs" 'overrides\.scope\(\*contest_id\)\.frozen_at\(\)'
check "the board view keeps the real user beside the row id" \
    has "${RANKING}/src/board.rs" 'pub user: String'
check "the team board groups by contest and team" \
    has "${RANKING}/src/board.rs" 'BTreeMap<\(i32, String\), TeamAcc>'
check "the override payload serves the contest key the page keys on" \
    has "${RANKING}/src/overrides.rs" 'c\.key AS contest'
check "a no-longer-global user override is gone from the ledger" \
    missing "${RANKING}/src/scoring.rs" 'board::is_hidden\(overrides,'

check "the page keys its override map by contest" \
    has_fixed "${RANKING}/static/DataStore.js" '+ scope] = row;'
check "the page resolves a hide inside the row's contest" \
    has "${RANKING}/static/DataStore.js" 'self\.is_hidden = function \(key, contest_id\)'
check "the page resolves a rename inside the row's contest" \
    has "${RANKING}/static/DataStore.js" 'self\.rename_for = function \(key, contest_id\)'
check "the page builds one row per user per contest" \
    has "${RANKING}/static/Scoreboard.js" 'self\.split_user = function \(user, contest\)'
check "the page ranks inside each contest" \
    has "${RANKING}/static/Scoreboard.js" 'self\.rank_contest_rows = function \(rows\)'
check "a row carries a contest-scoped DOM id" \
    has "${RANKING}/static/Scoreboard.js" 'data-row='
check "the contest column is styled" \
    has "${RANKING}/static/Ranking.css" '#Scoreboard_cols col\.contest'

check "the diagnostics counts the contests on the board and their scopes" \
    has "${RANKING}/src/http.rs" 'contests_with_overrides: standings\.overrides\.scoped_contests\(\)'
check "a contest with no override reads an empty scope" \
    has "${RANKING}/src/overrides.rs" 'pub fn is_empty\(&self\) -> bool'
check "ranks restart in each contest" \
    has "${RANKING}/tests/overrides.rs" 'fn ranks_restart_in_each_contest'
check "the live scope suite covers two shown contests" \
    has "${RANKING}/tests/override_scope.rs" 'a_user_in_two_shown_contests_gets_one_row_per_contest'
check "the live scope suite covers one user with two rows" \
    has "${RANKING}/tests/override_scope.rs" 'two_shown_contests_give_one_user_two_distinct_rows'
check "the page suite covers the cross-contest hide" \
    has "${RANKING}/static/tests/per-contest-rows.test.js" 'C1.s hide removes only the C1 row'

printf '%d passed, %d failed\n' "${passed}" "${failed}"
[[ "${failed}" -eq 0 ]]
