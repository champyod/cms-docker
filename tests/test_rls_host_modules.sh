#!/usr/bin/env bash
# tests/test_rls_host_modules.sh — read is staff+feed (RETURNING needs SELECT), write is the feed alone, and no DELETE policy exists.

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
GEN="${REPO_ROOT}/scripts/__generate_rls_sql.sh"
MIGRATIONS="${REPO_ROOT}/admin-panel/prisma/migrations"
TABLE="security_host_modules"

pass=0
fail=0
ok()  { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no()  { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

if [[ ! -f "$GEN" ]]; then
  printf '  FAIL scripts/__generate_rls_sql.sh is missing — nothing to check\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

# A policy statement may span lines, so it is read to its semicolon.
policy_stmt() {
  local text="$1" pol="$2"
  printf '%s\n' "$text" | awk -v pol="$pol" -v tbl="$TABLE" '
    !on && $0 ~ ("^CREATE POLICY " pol " ON public\\." tbl " FOR") { on = 1 }
    on { printf "%s ", $0; if ($0 ~ /;[[:space:]]*$/) exit }
  '
}

GENERATED="$(bash "$GEN" --emit-policies 2>/dev/null)"
if [[ -z "$GENERATED" ]]; then
  printf '  FAIL the generator produced no policy set\n'
  printf '\nPASS: 0  FAIL: 1\n'
  exit 1
fi

printf '\nthe table is classified as its own case, not folded into the findings grant\n'
host_list="$(sed -n 's/^HOST_MODULE_INGEST="\(.*\)"$/\1/p' "$GEN" | tr -s ' ' '\n' | sed '/^$/d')"
[[ "$host_list" == "$TABLE" ]] && ok "HOST_MODULE_INGEST names $TABLE" \
                             || no "HOST_MODULE_INGEST names '$host_list', expected '$TABLE'"
ingest_list="$(sed -n 's/^INGEST_WRITE="\(.*\)"$/\1/p' "$GEN")"
if [[ " $ingest_list " == *" $TABLE "* ]]; then
  no "$TABLE is also in INGEST_WRITE, which would grant staff INSERT and UPDATE"
else
  ok "$TABLE is not in INGEST_WRITE (staff may read it, not write it)"
fi

printf '\nstaff and the feed read it\n'
read_policy="$(policy_stmt "$GENERATED" cms_actor_read)"
if [[ "$read_policy" == *"cms_actor_is_staff()"* ]]; then
  ok "the read policy grants staff (the patching page renders reachability from this row)"
else
  no "the read policy does not grant staff: $read_policy"
fi
if [[ "$read_policy" == *"system:ingest"* ]]; then
  ok "the read policy grants system:ingest (INSERT … RETURNING needs to see the new row)"
else
  no "the read policy omits system:ingest — Prisma's upsert fails with 42501"
fi

printf '\nonly the feed writes it\n'
for verb in append update; do
  stmt="$(policy_stmt "$GENERATED" "cms_actor_${verb}")"
  if [[ -z "$stmt" ]]; then
    no "no $verb policy exists for $TABLE"
    continue
  fi
  if [[ "$stmt" == *"system:ingest"* ]]; then
    ok "$verb names system:ingest"
  else
    no "$verb does not name system:ingest: $stmt"
  fi
  if [[ "$stmt" == *"cms_actor_is_staff"* ]]; then
    no "$verb also grants staff — a human could rewrite what the box reports"
  else
    ok "$verb grants no staff identity"
  fi
done

printf '\nnothing may delete a host row, and nothing may keep a staff FOR ALL policy\n'
if printf '%s\n' "$GENERATED" | grep -q "^CREATE POLICY cms_actor_delete ON public\.$TABLE "; then
  no "a DELETE policy exists — a removed row reads as 'this box reports nothing'"
else
  ok "no DELETE policy exists for $TABLE"
fi
# The enable block creates a staff FOR ALL policy; if the set that follows does not drop it, Postgres ORs it in.
if printf '%s\n' "$GENERATED" | grep -q "^DROP POLICY IF EXISTS cms_actor_all ON public\.$TABLE;"; then
  ok "the set drops the staff FOR ALL policy the enable block created"
else
  no "cms_actor_all survives, and Postgres ORs permissive policies: staff keeps INSERT/UPDATE"
fi

printf '\nthe applied migration chain carries the same rules\n'
newest="$(grep -rl "BEGIN GENERATED POLICY SET" "$MIGRATIONS" 2>/dev/null | sort | tail -1)"
if [[ -z "$newest" ]]; then
  no "no migration carries the generated policy set"
else
  ok "the newest policy set is $(basename "$(dirname "$newest")")"
  if grep -q "^CREATE POLICY cms_actor_read ON public\.$TABLE FOR SELECT" "$newest" \
     && grep "^CREATE POLICY cms_actor_read ON public\.$TABLE FOR SELECT" "$newest" | grep -q 'system:ingest'; then
    ok "the chain grants the feed read on $TABLE"
  else
    no "the chain does not grant the feed read — every push fails with 42501"
  fi
  if grep "^CREATE POLICY cms_actor_append ON public\.$TABLE FOR INSERT" "$newest" | grep -q 'system:ingest'; then
    ok "the chain grants the feed append on $TABLE"
  else
    no "the chain does not grant the feed append — the module state is never stored"
  fi
  if grep "^CREATE POLICY cms_actor_append ON public\.$TABLE FOR INSERT" "$newest" | grep -q 'cms_actor_is_staff'; then
    no "the chain still lets staff append to $TABLE"
  else
    ok "the chain lets no staff identity append"
  fi
fi

if grep -rq "ALTER TABLE public\.$TABLE ENABLE ROW LEVEL SECURITY" "$MIGRATIONS" 2>/dev/null; then
  ok "RLS is enabled on $TABLE in migration history"
else
  no "no migration enables RLS on $TABLE — the policies are inert"
fi

if bash "${REPO_ROOT}/scripts/__generate_rls_sql.sh" --check >/dev/null 2>&1; then
  ok "the committed policy set is fresh against the generator"
else
  no "the committed policy set is stale — regenerate with scripts/__generate_rls_sql.sh --emit-policies"
fi

printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
