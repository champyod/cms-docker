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

# A policy statement may span lines (the generator wraps the audit_log predicate). Reading to the
# semicolon is the only way to test the statement rather than its first line.
policy_stmt() {
  local text="$1" pol="$2" tbl="$3"
  printf '%s\n' "$text" | awk -v pol="$pol" -v tbl="$tbl" '
    !on && $0 ~ ("^CREATE POLICY " pol " ON public\\.\"?" tbl "\"? FOR") { on = 1 }
    on { printf "%s ", $0; if ($0 ~ /;[[:space:]]*$/) exit }
  '
}

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
  read_policy="$(policy_stmt "$GENERATED" cms_actor_read "$tbl")"
  if [[ "$read_policy" == *"system:ingest"* ]]; then
    ok "$tbl: read policy names system:ingest (so INSERT … RETURNING can see its own row)"
  else
    no "$tbl: read policy does not name system:ingest — Prisma's upsert will fail with 42501"
  fi
  for verb in append update; do
    if policy_stmt "$GENERATED" "cms_actor_${verb}" "$tbl" | grep -q "system:ingest"; then
      ok "$tbl: $verb policy names system:ingest"
    else
      no "$tbl: $verb policy does not name system:ingest"
    fi
  done
done <<<"$INGEST_TABLES"

printf '\nevery table the ingest identity may append to, it may also read back\n'
# WHY stated as a rule and not a table list: Prisma writes with INSERT … RETURNING, so a table an
# ingest identity may append to but not read fails every write with 42501 — that is how both
# security_findings and audit_log broke, one after the other. The rule catches the next one.
# The audit_log predicate wraps over several lines, so the candidate list comes from the statement
# heads and the grant is checked on the whole statement.
append_tables="$(printf '%s\n' "$GENERATED" | grep -oE '^CREATE POLICY cms_actor_append ON public\.[a-z_]+ FOR INSERT' | sed 's/.*public\.//; s/ FOR INSERT//' | sort -u)"
append_ingest=""
while read -r tbl; do
  [[ -n "$tbl" ]] || continue
  if policy_stmt "$GENERATED" cms_actor_append "$tbl" | grep -q "system:ingest"; then
    append_ingest="${append_ingest}${tbl}"$'\n'
  fi
done <<<"$append_tables"
append_ingest="$(printf '%s' "$append_ingest" | sed '/^$/d')"
if [[ -z "$append_ingest" ]]; then
  no "no table grants the ingest identity append — the parse is broken, not the tree"
fi
while read -r tbl; do
  [[ -n "$tbl" ]] || continue
  if policy_stmt "$GENERATED" cms_actor_read "$tbl" | grep -q "system:ingest"; then
    ok "$tbl: appendable by ingest, and readable by ingest"
  else
    no "$tbl: ingest may append but not read — every write to it fails with 42501 (RETURNING)"
  fi
done <<<"$append_ingest"

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

printf '\nthe ingest identity may append to the audit trail it is required to write\n'
# WHY this is the same rule: every accepted push writes one audit row, so an ingest identity that
# cannot append to audit_log means the feed records findings and the trail records nothing. The
# first host scan produced 139 audit refusals that way, alarmed as "cannot write audit logs".
if policy_stmt "$GENERATED" cms_actor_append audit_log | grep -q "system:ingest"; then
  ok "generated: audit_log append policy names system:ingest"
else
  no "generated: audit_log append policy omits system:ingest — every feed push fails to audit"
fi
# The attribution rule must survive: a system identity may name another actor, an admin may not.
if policy_stmt "$GENERATED" cms_actor_append audit_log | grep -q "cms_actor_admin_id"; then
  ok "generated: the attribution rule is still in the append predicate"
else
  no "generated: the attribution rule vanished — an admin could forge another actor"
fi

last_audit="$(grep -rl "CREATE POLICY cms_actor_append ON public\.\"\?audit_log\"\? FOR INSERT" "$MIGRATIONS" 2>/dev/null | sort | tail -1)"
if [[ -n "$last_audit" ]] && policy_stmt "$(cat "$last_audit")" cms_actor_append audit_log | grep -q "system:ingest"; then
  ok "migrations: the newest audit_log append policy grants ingest ($(basename "$(dirname "$last_audit")"))"
else
  no "migrations: the newest audit_log append policy does not grant ingest — the database would still refuse feed audits"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
