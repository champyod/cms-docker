#!/usr/bin/env bash
# tests/test_role_catalog.sh — the committed role SQL is current, complete, and additive.
#
# WHY each assertion is separate: they are different ways the same change can go wrong, and none of
# them shows up as an error at apply time.
#   * stale  — the SQL still describes yesterday's catalog, so an application gets yesterday's grants;
#   * short  — one role is missing from the render, and the only symptom is a login that fails;
#   * wrong  — a role holds a privilege the tested matrix never gave it (a table-level UPDATE hands
#              out `authentication`, which is the whole point of the column grants);
#   * loud   — the file contains a statement that reassigns or removes something, which on a live
#              database takes the running application down.
# The suite therefore reads the two TSVs, the generated SQL, and re-runs the generator in a
# throwaway copy of the tree so `--check` is proven able to fail.
#
# No database is needed, and none is contacted.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
GEN="${REPO_ROOT}/scripts/__generate_role_sql.sh"
CATALOG="${REPO_ROOT}/admin-panel/prisma/roles/catalog.tsv"
GRANTS="${REPO_ROOT}/admin-panel/prisma/roles/grants.tsv"
OUT="${REPO_ROOT}/admin-panel/prisma/sql/20260820110000_generated_roles.sql"

pass=0
fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n' "$1"; fail=$((fail + 1)); }

summary() { printf '\nPASS: %d  FAIL: %d\n' "$pass" "$fail"; }

for missing in "$GEN" "$CATALOG" "$GRANTS" "$OUT"; do
  if [[ ! -f "$missing" ]]; then
    no "missing ${missing#"$REPO_ROOT"/} — run: bash scripts/__generate_role_sql.sh --write"
  fi
done
if (( fail > 0 )); then
  summary
  exit 1
fi

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

catalog_roles() { awk -F'\t' '!/^[[:space:]]*#/ && !/^[[:space:]]*$/ {print $1}' "$CATALOG"; }

# ── 1. Freshness ────────────────────────────────────────────────────────────────────────────
# WHY first: every assertion below reads the committed file, so a stale file would make the rest of
# the suite describe something the generator does not produce.
printf '== the committed SQL is what the generator renders today ==\n'
if check_out=$(bash "$GEN" --check 2>&1); then
  ok "--check: the generated SQL matches catalog.tsv and grants.tsv"
else
  no "--check reports drift — the committed SQL is stale"
  printf '%s\n' "$check_out" | sed 's/^/        /'
fi

# ── 2. Every catalog role is in the render, with the catalogued login attribute ───────────────
printf '\n== every catalogued role is rendered ==\n'
role_count=0
missing_roles=""
bad_login=""
while IFS=$'\t' read -r role login _bypass _comment; do
  [[ -n "${role:-}" ]] || continue
  role_count=$((role_count + 1))
  grep -qF "('${role}'," "$OUT" || missing_roles="${missing_roles} ${role}"
  want="LOGIN"
  [[ "$login" == "no" ]] && want="NOLOGIN"
  grep -qF "('${role}', '${want}')" "$OUT" || bad_login="${bad_login} ${role}(${login})"
done < <(awk -F'\t' '!/^[[:space:]]*#/ && !/^[[:space:]]*$/ {print}' "$CATALOG")

if [[ -n "$missing_roles" ]]; then
  no "role(s) in catalog.tsv but not in the generated SQL:${missing_roles}"
else
  ok "all ${role_count} catalogued roles appear in the generated SQL"
fi
if [[ -n "$bad_login" ]]; then
  no "role(s) rendered with the wrong login attribute:${bad_login}"
else
  ok "every role carries the login attribute catalog.tsv declares (NOLOGIN for owner)"
fi

rendered_roles=$(grep -cE "^      \('cms_[a-z0-9_]+', '(NOLOGIN|LOGIN)'\)" "$OUT" || true)
if [[ "$rendered_roles" == "$role_count" ]]; then
  ok "the render has exactly ${role_count} role rows (no extras, no duplicates)"
else
  no "the render has ${rendered_roles} role rows, catalog.tsv declares ${role_count}"
fi

# ── 3. The admins grant matrix, exactly as the rehearsal proved it ───────────────────────────
printf '\n== the admins grants are exactly the tested matrix ==\n'
expected_grants=(
  "GRANT SELECT (username, authentication, enabled) ON public.admins TO cms_admin_login"
  "GRANT SELECT (id, username, name, enabled, last_login_at) ON public.admins TO cms_admin_read_people"
  "GRANT SELECT (id, username) ON public.admins TO cms_admin_write_people"
  "GRANT UPDATE (name, username) ON public.admins TO cms_admin_write_people"
  "GRANT SELECT (id, username) ON public.admins TO cms_admin_account_security"
  "GRANT UPDATE (authentication, enabled) ON public.admins TO cms_admin_account_security"
  "GRANT INSERT (username, authentication, enabled, name) ON public.admins TO cms_admin_account_security"
  "GRANT USAGE ON SEQUENCE public.admins_id_seq TO cms_admin_account_security"
  "GRANT DELETE ON public.admins TO cms_admin_account_security"
)
actual_grants=$(grep -oE "GRANT [A-Z]+( \([^)]*\))? ON (SEQUENCE )?public\.[a-z0-9_.]+ TO [a-z0-9_]+" "$OUT" | LC_ALL=C sort)
expected_grants_sorted=$(printf '%s\n' "${expected_grants[@]}" | LC_ALL=C sort)

while IFS= read -r want; do
  [[ -n "$want" ]] || continue
  if grep -qF "$want" "$OUT"; then
    ok "grant: ${want#GRANT }"
  else
    no "missing grant: ${want#GRANT }"
  fi
done < <(printf '%s\n' "${expected_grants[@]}")

if [[ "$actual_grants" == "$expected_grants_sorted" ]]; then
  ok "the file grants nothing beyond that matrix (no extra privilege anywhere)"
else
  no "the file's grant set differs from the tested matrix"
  diff <(printf '%s\n' "$expected_grants_sorted") <(printf '%s\n' "$actual_grants") | sed 's/^/        /'
fi

printf '\n== the writer roles cannot cross their columns ==\n'
# WHY stated as absences: the rehearsal's failures were all a privilege a role should NOT have had,
# and a missing check on an absence is how "it looked fine" happens.
if grep -qE "GRANT UPDATE ON public\." "$OUT"; then
  no "a table-level UPDATE is granted — that hands over every column, including authentication"
else
  ok "no table-level UPDATE: every UPDATE names its columns"
fi
if grep -qE "GRANT (ALL|TRUNCATE|REFERENCES|TRIGGER)" "$OUT"; then
  no "a blanket or structural privilege is granted (ALL/TRUNCATE/REFERENCES/TRIGGER)"
else
  ok "no blanket or structural privilege (ALL/TRUNCATE/REFERENCES/TRIGGER)"
fi
if grep -qE "GRANT (INSERT|DELETE|UPDATE)[^;]* TO cms_admin_(login|read_people)" "$OUT"; then
  no "a read-only role is granted a write"
else
  ok "the login and people-read roles hold no write privilege"
fi

# ── 4. The RLS policy set, exactly ──────────────────────────────────────────────────────────
printf '\n== each role has the policy its grants need ==\n'
expected_policies=$(LC_ALL=C sort <<'EOF'
cms_admin_login_select|admins|SELECT|cms_admin_login
cms_admin_read_people_select|admins|SELECT|cms_admin_read_people
cms_admin_write_people_select|admins|SELECT|cms_admin_write_people
cms_admin_write_people_update|admins|UPDATE|cms_admin_write_people
cms_admin_account_security_select|admins|SELECT|cms_admin_account_security
cms_admin_account_security_update|admins|UPDATE|cms_admin_account_security
cms_admin_account_security_insert|admins|INSERT|cms_admin_account_security
cms_admin_account_security_delete|admins|DELETE|cms_admin_account_security
EOF
)
actual_policies=$(grep -oE "CREATE POLICY [a-z0-9_]+ ON public\.[a-z0-9_]+ FOR [A-Z]+ TO [a-z0-9_]+" "$OUT" \
  | sed -E 's/^CREATE POLICY ([a-z0-9_]+) ON public\.([a-z0-9_]+) FOR ([A-Z]+) TO ([a-z0-9_]+)$/\1|\2|\3|\4/' \
  | LC_ALL=C sort)
if [[ "$actual_policies" == "$expected_policies" ]]; then
  ok "the policy set is exactly the matrix: SELECT for readers, SELECT+UPDATE for the profile writer, four verbs for account security"
else
  no "the policy set differs from the matrix"
  diff <(printf '%s\n' "$expected_policies") <(printf '%s\n' "$actual_policies") | sed 's/^/        /'
fi

dup_policies=$(printf '%s\n' "$actual_policies" | awk -F'|' '{print $2 "|" $1}' | LC_ALL=C sort | uniq -d)
if [[ -z "$dup_policies" ]]; then
  ok "no duplicate policy name on a table"
else
  no "duplicate policy name(s): ${dup_policies}"
fi

create_count=$(grep -c "CREATE POLICY " "$OUT" || true)
drop_count=$(grep -c "DROP POLICY IF EXISTS " "$OUT" || true)
if [[ "$create_count" == "$drop_count" ]]; then
  ok "every CREATE POLICY is preceded by a DROP POLICY IF EXISTS (${create_count} each: re-appliable)"
else
  no "CREATE POLICY (${create_count}) and DROP POLICY IF EXISTS (${drop_count}) differ — a re-apply would fail"
fi

# ── 5. Nothing in the file can disturb the running database ─────────────────────────────────
printf '\n== the file is additive only ==\n'
for token in 'REVOKE' 'OWNER TO' "PASSWORD '" 'DROP TABLE' 'CREATE ROLE cmsuser' 'CREATE ROLE cms_backup' 'ALTER TABLE'; do
  if grep -qF -- "$token" "$OUT"; then
    no "forbidden statement in the generated SQL: ${token}"
  else
    ok "absent: ${token}"
  fi
done
if [[ "$(grep -c 'cmsuser' "$OUT" || true)" -eq 0 ]]; then
  ok "the file never names cmsuser — it cannot change what the running application may do"
else
  no "the file names cmsuser — this slice must not touch the role the application uses"
fi
non_policy_drops=$(grep -n 'DROP ' "$OUT" | grep -v 'DROP POLICY IF EXISTS' || true)
if [[ -z "$non_policy_drops" ]]; then
  ok "the only DROP is DROP POLICY IF EXISTS"
else
  no "a DROP other than DROP POLICY IF EXISTS is present"
  printf '%s\n' "$non_policy_drops" | sed 's/^/        /'
fi
if [[ "$(grep -c 'CREATE ROLE' "$OUT" || true)" -eq 1 ]] && grep -q "CREATE ROLE %I %s PASSWORD NULL" "$OUT"; then
  ok "role creation is one guarded statement with PASSWORD NULL (no secret in the file)"
else
  no "role creation is not the single guarded PASSWORD NULL statement this file is allowed"
fi
if grep -qE "CREATE ROLE [^']*BYPASSRLS" "$OUT" && ! grep -q "NOBYPASSRLS" "$OUT"; then
  no "a role is created with BYPASSRLS — the catalog records the intent, the file must not grant it"
else
  ok "no role is created with BYPASSRLS (the catalogued intent stays a later step)"
fi

# ── 6. Every name is inside the contract ────────────────────────────────────────────────────
printf '\n== role names follow the contract ==\n'
bad_names=""
while IFS= read -r role; do
  [[ -n "$role" ]] || continue
  if [[ "$role" =~ ^cms_platform_[a-z][a-z0-9]*$ ]] \
    || [[ "$role" == "cms_admin_login" ]] \
    || [[ "$role" =~ ^cms_admin_(read|write|operate|account)_[a-z][a-z0-9]*$ ]]; then
    continue
  fi
  bad_names="${bad_names} ${role}"
done < <(catalog_roles)
if [[ -n "$bad_names" ]]; then
  no "catalogued role(s) outside the contract:${bad_names}"
else
  ok "every catalogued name is cms_platform_<capability> or cms_admin_<capability>_<domain>"
fi

invented=$(LC_ALL=C comm -13 <(catalog_roles | LC_ALL=C sort -u) \
  <(grep -oE "^      \('cms_[a-z0-9_]+'" "$OUT" | sed "s/.*('//;s/'//" | LC_ALL=C sort -u))
if [[ -z "$invented" ]]; then
  ok "the render introduces no role the catalog does not declare"
else
  no "the render creates role(s) not in catalog.tsv: ${invented}"
fi

# ── 7. The gate itself can fail ─────────────────────────────────────────────────────────────
# WHY: a --check that cannot fail is decoration. Each case mutates a throwaway copy of the tree and
# asserts the generator's verdict, so the real tree is never touched.
printf '\n== --check is falsifiable ==\n'
new_sandbox() {
  SB="$(mktemp -d)"
  SANDBOXES+=("$SB")
  mkdir -p "${SB}/scripts/__lib" "${SB}/admin-panel/prisma/roles" "${SB}/admin-panel/prisma/sql"
  cp "$GEN" "${SB}/scripts/__generate_role_sql.sh"
  cp "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}/scripts/__lib/common.sh"
  cp "$CATALOG" "$GRANTS" "${SB}/admin-panel/prisma/roles/"
  cp "$OUT" "${SB}/admin-panel/prisma/sql/"
}

new_sandbox
printf '%s\n' "-- a line an operator added by hand" >> "${SB}/admin-panel/prisma/sql/20260820110000_generated_roles.sql"
if drift_out=$(bash "${SB}/scripts/__generate_role_sql.sh" --check 2>&1); then
  no "drift: --check accepted a file with an extra line"
else
  if printf '%s\n' "$drift_out" | grep -q "regenerate: bash scripts/__generate_role_sql.sh --write"; then
    ok "drift: --check fails and names the regenerate command"
  else
    no "drift: --check failed but did not name the regenerate command"
  fi
fi

new_sandbox
printf 'cms_admin_login\tadmins\tSELECT\tusername\n' >> "${SB}/admin-panel/prisma/roles/catalog.tsv"
if bash "${SB}/scripts/__generate_role_sql.sh" --check >/dev/null 2>&1; then
  no "duplicate role: the generator accepted the same role twice"
else
  ok "duplicate role: the generator refuses it"
fi

new_sandbox
printf 'cms_admin_Read_people\tno\trw\tnot a capability\n' >> "${SB}/admin-panel/prisma/roles/catalog.tsv"
if bash "${SB}/scripts/__generate_role_sql.sh" --check >/dev/null 2>&1; then
  no "bad name: the generator accepted a name outside the contract"
else
  ok "bad name: the generator refuses a name outside the contract"
fi

new_sandbox
rm -f "${SB}/admin-panel/prisma/sql/20260820110000_generated_roles.sql"
if bash "${SB}/scripts/__generate_role_sql.sh" --check >/dev/null 2>&1; then
  no "missing file: --check passed with no generated SQL in the tree"
else
  ok "missing file: --check fails when the generated SQL is absent"
fi

new_sandbox
if cmp -s "$OUT" "${SB}/admin-panel/prisma/sql/20260820110000_generated_roles.sql" \
  && bash "${SB}/scripts/__generate_role_sql.sh" > "${SB}/stdout.sql" 2>/dev/null \
  && cmp -s "$OUT" "${SB}/stdout.sql" \
  && cmp -s "$OUT" "${SB}/admin-panel/prisma/sql/20260820110000_generated_roles.sql"; then
  ok "a plain run prints the committed SQL to stdout and writes nothing"
else
  no "a plain run did not reproduce the committed SQL on stdout"
fi

summary
[[ $fail -eq 0 ]]
