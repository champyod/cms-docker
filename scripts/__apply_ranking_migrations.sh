#!/usr/bin/env bash
# __apply_ranking_migrations.sh — apply the ranking schema to a database, strictly.
#
# WHY this exists: the ranking migrations are applied from three places — CI, the acceptance
# rehearsal, and an operator's install — and each used to decide for itself what "applied"
# meant. CI ran them without ON_ERROR_STOP, so a statement could fail while the job went green;
# the rehearsal had the same hole behind a `|| fail` that could never fire, because psql exits
# 0 after a failed statement unless ON_ERROR_STOP is set. A rehearsal that cannot fail is
# evidence of nothing, and a green CI job on a half-applied schema is how a missing table
# reached a scoreboard. One implementation, called by every caller, keeps those answers equal.
#
# The rule it enforces:
#   1. every *_ranking_* migration applies with ON_ERROR_STOP=1;
#   2. exactly ONE file may depend on the classic CMS schema this repository carries neither as
#      a migration nor as a fixture — and it is NAMED here, not matched by error text, so the
#      same error in any other file fails the run instead of passing quietly;
#   3. the arithmetic closes: files found == files applied strictly + files tolerated.
#
# Usage: __apply_ranking_migrations.sh <database-url> [repo-root]
# Exit:  0 applied, 1 failed, 2 usage.

set -uo pipefail

readonly CMD="${0##*/}"

usage() {
    printf 'usage: %s <database-url> [repo-root]\n' "$CMD" >&2
    exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
readonly URL="$1"
# Default to the repository this script lives in, so a caller that runs it from anywhere gets
# the migrations belonging to the code it just changed.
readonly ROOT="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# GitHub renders these as annotations; locally they are ordinary lines. The report is the same
# in both places, which is the point.
notice() {
    if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then printf '::notice::%s\n' "$1"; else printf '[note] %s\n' "$1"; fi
}
error() {
    if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then printf '::error::%s\n' "$1"; else printf '[error] %s\n' "$1" >&2; fi
}

command -v psql >/dev/null 2>&1 || { error "psql is not on PATH"; exit 1; }
readonly MIGRATIONS="${ROOT}/admin-panel/prisma/migrations"
[[ -d "$MIGRATIONS" ]] || { error "no migrations directory at ${MIGRATIONS}"; exit 1; }

# The one file that writes the panel's identity tables (permissions, groups, group_permissions,
# admins, admin_groups). Naming it — rather than tolerating the signature wherever it appears —
# is what stops a future migration from reaching for that schema and passing silently.
readonly NEEDS_CLASSIC="20261012020000_drop_ranking_console_users"
readonly CLASSIC='relation "(permissions|groups|group_permissions|admins|admin_groups|ranking_console_users)" does not exist'

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

# The RLS policies in these migrations name the deployment's runtime role, so any database that
# carries this schema must have it. A real installation always does, which makes this a no-op
# there; a test database gets the same shape instead of a schema whose policies cannot bind.
if ! psql "$URL" -q -v ON_ERROR_STOP=1 -c \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cmsuser') THEN CREATE ROLE cmsuser; END IF; END \$\$;" 2>"$ERR"; then
    error "could not ensure the cmsuser role exists"
    cat "$ERR" >&2
    exit 1
fi

strict=0
known=0
total=0
for migration in "${MIGRATIONS}"/*_ranking_*/; do
    [[ -d "$migration" ]] || continue
    total=$((total + 1))
    name="$(basename "$migration")"
    if psql "$URL" -q -v ON_ERROR_STOP=1 -f "${migration}migration.sql" >/dev/null 2>"$ERR"; then
        strict=$((strict + 1))
        continue
    fi
    if [[ "$name" == "$NEEDS_CLASSIC" ]] && grep -qE "ERROR:  ${CLASSIC}" "$ERR"; then
        known=$((known + 1))
        notice "${name} needs the classic CMS schema, as expected"
        continue
    fi
    error "${name} failed for a reason this run does not tolerate"
    cat "$ERR" >&2
    exit 1
done

[[ "$total" -gt 0 ]] || { error "no *_ranking_* migration directory was found under ${MIGRATIONS}"; exit 1; }
if [[ $((strict + known)) -ne "$total" ]]; then
    error "${total} migration directories found but only $((strict + known)) accounted for"
    exit 1
fi

printf 'applied strictly: %d, classic-schema dependency: %d, files: %d\n' "$strict" "$known" "$total"
