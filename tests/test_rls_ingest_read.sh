#!/usr/bin/env bash
# tests/test_rls_ingest_read.sh — an identity that may write a row must be able to read it back.
#
# WHY: Postgres refuses `INSERT … RETURNING` when the new row is not visible under the table's
# SELECT policy, and Prisma upserts with RETURNING. So an ingest identity granted INSERT but not
# SELECT fails on every write with 42501 "new row violates row-level security policy" — an error
# that names the write policy while the missing permission is on the read side. That is exactly how
# the security feed came to record nothing on a live host while every policy looked correct in
# isolation. The rule is structural: every table in INGEST_WRITE grants the ingest identity read,
# and the applied migration chain carries that grant.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
GEN="${REPO_ROOT}/scripts/__generate_rls_sql.sh"
MIGRATIONS="${REPO_ROOT}/admin-panel/prisma/migrations"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [[ ! -f "$GEN" ]]; then
  printf '  FAIL scripts/__generate_rls_sql.sh is missing — nothing to check\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

GENERATED="$(bash "$GEN" --emit-policies 2>/dev/null)"
if [[ -z "$GENERATED" ]]; then
  printf '  FAIL the generator produced no policy set\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

# INGEST_WRITE is the variable naming the tables the feed container writes.
INGEST_TABLES="$(sed -n 's/^INGEST_WRITE="\(.*\)"$/\1/p' "$GEN" | tr -s ' ' '\n' | sed '/^$/d')"
if [[ -z "$INGEST_TABLES" ]]; then
  no "no INGEST_WRITE table list was found — the parse is broken, not the tree"
else
  ok "INGEST_WRITE names $(printf '%s\n' "$INGEST_TABLES" | wc -l | tr -d ' ') table(s)"
fi

printf '\nthe generated policy set grants ingest read + write on every ingest table\n'
while read -r tbl; do
  [[ -n "$tbl" ]] || continue
  read_policy="$(printf '%s\n' "$GENERATED" | grep -E "^CREATE POLICY cms_actor_read ON public\.${tbl} FOR SELECT")"
  if [[ "$read_policy" == *"system:ingest"* ]]; then
    ok "$tbl: read policy names system:ingest (so INSERT … RETURNING can see its own row)"
  else
    no "$tbl: read policy does not name system:ingest — Prisma's upsert will fail with 42501"
  fi
  for verb in append update; do
    if printf '%s\n' "$GENERATED" | grep -E "^CREATE POLICY cms_actor_${verb} ON public\.${tbl} " | grep -q "system:ingest"; then
      ok "$tbl: $verb policy names system:ingest"
    else
      no "$tbl: $verb policy does not name system:ingest"
    fi
  done
done <<<"$INGEST_TABLES"

printf '\nthe applied migration chain carries the same grant\n'
while read -r tbl; do
  [[ -n "$tbl" ]] || continue
  # The LAST migration that writes a read policy for this table is the one in force.
  last="$(grep -rl "CREATE POLICY cms_actor_read ON public\\.\"\\?${tbl}\"\\? FOR SELECT" "$MIGRATIONS" 2>/dev/null | sort | tail -1)"
  if [[ -z "$last" ]]; then
    no "$tbl: no migration creates its read policy"
    continue
  fi
  # Same LINE only: -A2 would read the append policy on the next line and call it granted.
  if grep -E "^CREATE POLICY cms_actor_read ON public\.\"?${tbl}\"? FOR SELECT" "$last" | grep -q "system:ingest"; then
    ok "$tbl: the newest read policy in the chain ($(basename "$(dirname "$last")")) grants ingest"
  else
    no "$tbl: the newest read policy in the chain ($(basename "$(dirname "$last")")) does NOT grant ingest — the generator was fixed but the database was not"
  fi
done <<<"$INGEST_TABLES"

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
