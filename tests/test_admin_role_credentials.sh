#!/usr/bin/env bash

# Static or stubbed only: the real path runs against a production database.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

SQL_FILE="${REPO_ROOT}/admin-panel/prisma/sql/20260820119000_admin_role_passwords.sql"
GEN_SQL="${REPO_ROOT}/admin-panel/prisma/sql/20260820110000_generated_roles.sql"
APPLY="${REPO_ROOT}/scripts/__apply_sql.sh"
SYNC="${REPO_ROOT}/scripts/__config_sync.sh"
ENGINE="${REPO_ROOT}/scripts/__update_engine.sh"
COMPOSE="${REPO_ROOT}/docker-compose.yml"
EXAMPLE="${REPO_ROOT}/config.toml.example"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cms-admin-role-creds.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

check_grep() { # <label> <pattern> <file>
  if grep -qE -- "$2" "$3" 2>/dev/null; then ok "$1"; else no "$1 (pattern not found: $2)"; fi
}
check_not_grep() {
  if grep -qE -- "$2" "$3" 2>/dev/null; then no "$1 (pattern unexpectedly found: $2)"; else ok "$1"; fi
}
check_literal() { # <label> <fixed string> <file>
  if grep -qF -- "$2" "$3" 2>/dev/null; then ok "$1"; else no "$1 (not found: $2)"; fi
}

# ── 1. Shell syntax ─────────────────────────────────────────────────────────────────────────
printf '== changed shell scripts parse ==\n'
for script in "$APPLY" "$SYNC" "$ENGINE"; do
  if bash -n "$script" 2>"$TEST_ROOT/syntax.err"; then
    ok "bash -n ${script#"$REPO_ROOT"/}"
  else
    no "bash -n ${script#"$REPO_ROOT"/} — $(cat "$TEST_ROOT/syntax.err")"
  fi
done

# ── 2. The credential SQL ───────────────────────────────────────────────────────────────────
printf '\n== the credential SQL is superuser-only and idempotent ==\n'
if [[ -f "$SQL_FILE" ]]; then
  ok "the credential SQL exists"
else
  no "the credential SQL exists"
fi
if head -n 5 "$SQL_FILE" 2>/dev/null | grep -qx -- '-- superuser-only'; then
  ok "the marker '-- superuser-only' is in the file header"
else
  no "the marker '-- superuser-only' is in the file header"
fi
for key in admin_login_password admin_read_password admin_security_password; do
  check_literal "set_config carries ${key}" "set_config('my.${key}', :'${key}', false)" "$SQL_FILE"
done
for role in cms_admin_login cms_admin_read_people cms_admin_account_security; do
  check_grep "the SQL names ${role}" "\\('${role}'," "$SQL_FILE"
done
check_literal "one DO block re-reads each setting" "current_setting('my.admin_login_password', true)" "$SQL_FILE"
check_literal "the ALTER is built from the role and the setting" "ALTER ROLE %I WITH PASSWORD %L" "$SQL_FILE"
check_grep "the ALTER only runs for an existing role" "FROM pg_roles WHERE rolname = r.rolname" "$SQL_FILE"
check_grep "the ALTER only runs for a non-empty setting" "_pw <> ''" "$SQL_FILE"
check_not_grep "no password literal in the SQL" "PASSWORD[[:space:]]+'[^']" "$SQL_FILE"
check_not_grep "no hex secret pasted into the SQL" "[0-9a-f]{32,}" "$SQL_FILE"
if [[ -f "$GEN_SQL" ]]; then
  order="$(printf '%s\n' "$(basename "$GEN_SQL")" "$(basename "$SQL_FILE")" 20260820120000_db_roles.sql | LC_ALL=C sort | paste -sd' ' -)"
  if [[ "$order" == "$(basename "$GEN_SQL") $(basename "$SQL_FILE") 20260820120000_db_roles.sql" ]]; then
    ok "the file sorts after role creation and before the backup role"
  else
    no "the file sorts after role creation and before the backup role (got: $order)"
  fi
fi

# ── 3. config.toml.example and the secret generator ────────────────────────────────────────
printf '\n== config.toml.example declares the three secrets ==\n'
awk '/^\[admin\]/{f=1;next} /^\[/{f=0} f' "$EXAMPLE" > "$TEST_ROOT/admin-section.toml"
for key in ADMIN_LOGIN_PASSWORD ADMIN_READ_PASSWORD ADMIN_SECURITY_PASSWORD; do
  if grep -qE "^${key} = \"\"[[:space:]]*#" "$TEST_ROOT/admin-section.toml"; then
    ok "[admin] ${key} is an empty key"
  else
    no "[admin] ${key} is an empty key"
  fi
  if grep -qE "^${key} = \"\".*generated on first sync" "$TEST_ROOT/admin-section.toml"; then
    ok "[admin] ${key} says it is generated on first sync"
  else
    no "[admin] ${key} says it is generated on first sync"
  fi
  check_grep "generate_secret_for has an arm for ${key}" "^[[:space:]]*${key}\\)[[:space:]]+gen_hex32" "$SYNC"
  check_grep "VAR_SPECS lists ${key} as a hex32 secret" "\\|${key}\\|secret\\|\\|hex32" "$ENGINE"
done

# ── 4. compose URLs ────────────────────────────────────────────────────────────────────────
printf '\n== the panel service carries one URL per role and no literal secret ==\n'
awk '/^x-admin-panel:/{f=1} /^services:/{f=0} f' "$COMPOSE" > "$TEST_ROOT/panel-anchor.yml"
for pair in \
  'ADMIN_LOGIN_DATABASE_URL|postgresql://cms_admin_login:${ADMIN_LOGIN_PASSWORD}@database:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-cmsdb}' \
  'ADMIN_READ_DATABASE_URL|postgresql://cms_admin_read_people:${ADMIN_READ_PASSWORD}@database:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-cmsdb}' \
  'ADMIN_SECURITY_DATABASE_URL|postgresql://cms_admin_account_security:${ADMIN_SECURITY_PASSWORD}@database:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-cmsdb}'; do
  var="${pair%%|*}"
  url="${pair#*|}"
  check_literal "the panel anchor sets ${var}" "${var}: ${url}" "$TEST_ROOT/panel-anchor.yml"
  if grep -qE "^[[:space:]]*${var}: postgresql://cms_admin_[a-z_]+:[^$]" "$TEST_ROOT/panel-anchor.yml"; then
    no "${var} holds a literal password"
  else
    ok "${var} holds no literal password"
  fi
done
check_grep "the existing DATABASE_URL is kept" "^[[:space:]]*DATABASE_URL: postgresql://" "$TEST_ROOT/panel-anchor.yml"

printf '\n== the classic admin carries the same security URL ==\n'
awk '/^  admin-web-server:/{f=1; next} /^  [a-z][a-z0-9-]*:/{f=0} f' "$COMPOSE" > "$TEST_ROOT/classic-admin.yml"
if grep -qE '^[[:space:]]*ADMIN_SECURITY_DATABASE_URL: postgresql://cms_admin_account_security:\$\{ADMIN_SECURITY_PASSWORD\}@database:' "$TEST_ROOT/classic-admin.yml"; then
  ok "admin-web-server sets ADMIN_SECURITY_DATABASE_URL as cms_admin_account_security with the generated secret"
else
  no "admin-web-server does not set ADMIN_SECURITY_DATABASE_URL as cms_admin_account_security"
fi
if grep -qE '^[[:space:]]*ADMIN_SECURITY_DATABASE_URL: postgresql://cms_admin_[a-z_]+:[^$]' "$TEST_ROOT/classic-admin.yml"; then
  no "the classic admin's ADMIN_SECURITY_DATABASE_URL holds a literal password"
else
  ok "the classic admin's ADMIN_SECURITY_DATABASE_URL holds no literal password"
fi

# ── 5. apply script: static contract ───────────────────────────────────────────────────────
printf '\n== __apply_sql.sh hands the three secrets in and selects the superuser phase ==\n'
for var in ADMIN_LOGIN_PASSWORD ADMIN_READ_PASSWORD ADMIN_SECURITY_PASSWORD; do
  check_literal "reads ${var} from .env" "get_env_val \"${var}\"" "$APPLY"
done
for name in admin_login_password admin_read_password admin_security_password; do
  check_literal "passes -v ${name}" "${name}=\$ADMIN_" "$APPLY"
done
check_grep "uses the local postgres superuser path" "psql -U postgres" "$APPLY"
check_not_grep "the superuser path is not routed through docker_exec_db" "docker_exec_db .*psql -U postgres" "$APPLY"
check_grep "bootstrap selects the superuser-only marker" "superuser_only_file" "$APPLY"
check_grep "the normal apply skips the marker" "skipping superuser-only file" "$APPLY"

# ── 6. apply script behaviour with a stub docker ───────────────────────────────────────────
printf '\n== bootstrap applies as postgres; the normal apply skips the marker ==\n'
STUB_DIR="$TEST_ROOT/bin"
mkdir -p "$STUB_DIR" "$TEST_ROOT/apply/scripts" "$TEST_ROOT/apply/admin-panel/prisma"
cp "$APPLY" "$TEST_ROOT/apply/scripts/__apply_sql.sh"
cp -r "${REPO_ROOT}/scripts/__lib" "$TEST_ROOT/apply/scripts/"
cp -r "${REPO_ROOT}/admin-panel/prisma/sql" "$TEST_ROOT/apply/admin-panel/prisma/sql"
cat > "$TEST_ROOT/apply/.env" <<'ENV'
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=fixture_owner_pw
POSTGRES_DB=cmsdb
POSTGRES_BACKUP_PASSWORD=fixture_backup_pw
ADMIN_LOGIN_PASSWORD=fixture_login_pw
ADMIN_READ_PASSWORD=fixture_read_pw
ADMIN_SECURITY_PASSWORD=fixture_security_pw
ENV
chmod 600 "$TEST_ROOT/apply/.env"
cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
# Fake docker: records every exec and the SQL on stdin; never touches a daemon.
if [[ "${1:-}" == "ps" ]]; then
  printf '%s\n' "${STUB_PS_OUT-cms-database}"
  exit 0
fi
if [[ "${1:-}" == "exec" ]]; then
  printf 'CALL %s\n' "$*" >> "$STUB_CALLS"
  if [[ -n "${PGPASSWORD+set}" ]]; then
    printf 'ENV PGPASSWORD=set\n' >> "$STUB_CALLS"
  else
    printf 'ENV PGPASSWORD=unset\n' >> "$STUB_CALLS"
  fi
  # A deployment without a postgres role: the superuser probe and every -U postgres call fail.
  if [[ " $* " == *" psql -U postgres "* && "${STUB_POSTGRES_FAIL:-0}" == "1" ]]; then
    exit 1
  fi
  if [[ " $* " == *"SELECT rolsuper"* ]]; then
    printf '%s\n' "${STUB_APP_SUPER:-f}"
    exit 0
  fi
  if [[ " $* " == *" -f - "* ]]; then
    printf '<<<SQL %s\n' "$*" >> "$STUB_STDIN"
    cat >> "$STUB_STDIN"
    printf '\nSQL>>>\n' >> "$STUB_STDIN"
  fi
  exit 0
fi
exit 0
STUB
chmod +x "$STUB_DIR/docker"

run_apply() { # <mode|-> <calls> <stdin> <log> [ps_out] [postgres_fail] [app_super]
  local mode="$1" calls="$2" stdin_log="$3" log="$4" ps_out="${5-cms-database}" pg_fail="${6:-0}" app_super="${7:-f}"
  : > "$calls"; : > "$stdin_log"
  (
    cd "$TEST_ROOT/apply" || exit 1
    env -u PGPASSWORD PATH="$STUB_DIR:$PATH" \
      STUB_CALLS="$calls" STUB_STDIN="$stdin_log" STUB_PS_OUT="$ps_out" \
      STUB_POSTGRES_FAIL="$pg_fail" STUB_APP_SUPER="$app_super" \
      bash "$TEST_ROOT/apply/scripts/__apply_sql.sh" ${mode:+$mode}
  ) > "$log" 2>&1
}

BOOT_CALLS="$TEST_ROOT/boot.calls"; BOOT_STDIN="$TEST_ROOT/boot.stdin"
boot_rc=0
run_apply --bootstrap-roles "$BOOT_CALLS" "$BOOT_STDIN" "$TEST_ROOT/boot.log" || boot_rc=$?
if [[ "$boot_rc" -eq 0 ]]; then ok "bootstrap exits 0"; else no "bootstrap exits 0 (got ${boot_rc})"; fi
check_grep "bootstrap connects as the local postgres superuser" "CALL exec -u postgres -i cms-database psql -U postgres -d cmsdb" "$BOOT_CALLS"
check_not_grep "bootstrap never connects as the application role" "psql -U cmsuser" "$BOOT_CALLS"
check_grep "bootstrap applies the marker-only credential file" "admin_role_passwords.sql" "$BOOT_STDIN"
check_grep "bootstrap still applies the generated role file" "generated_roles.sql" "$BOOT_STDIN"
check_grep "bootstrap still applies the backup role file" "backup_role.sql" "$BOOT_STDIN"
for name in admin_login_password admin_read_password admin_security_password; do
  check_literal "bootstrap passes -v ${name}" "-v ${name}=fixture_" "$BOOT_CALLS"
done
check_grep "the superuser phase carries no PGPASSWORD" "^ENV PGPASSWORD=unset$" "$BOOT_CALLS"
check_not_grep "the superuser phase never sets PGPASSWORD" "^ENV PGPASSWORD=set$" "$BOOT_CALLS"

NORM_CALLS="$TEST_ROOT/normal.calls"; NORM_STDIN="$TEST_ROOT/normal.stdin"
norm_rc=0
run_apply "" "$NORM_CALLS" "$NORM_STDIN" "$TEST_ROOT/normal.log" || norm_rc=$?
if [[ "$norm_rc" -eq 0 ]]; then ok "normal apply exits 0"; else no "normal apply exits 0 (got ${norm_rc})"; fi
check_grep "normal apply reports the skipped superuser file" "skipping superuser-only file" "$TEST_ROOT/normal.log"
check_not_grep "normal apply does not send the superuser-only SQL" "admin_role_passwords.sql" "$NORM_STDIN"
check_grep "normal apply still applies the role file" "generated_roles.sql" "$NORM_STDIN"
check_grep "normal apply keeps the application-role connection" "psql -U cmsuser -d cmsdb" "$NORM_CALLS"
check_grep "normal apply keeps the PGPASSWORD handover" "^ENV PGPASSWORD=set$" "$NORM_CALLS"
for name in admin_login_password admin_read_password admin_security_password; do
  check_literal "normal apply passes -v ${name}" "-v ${name}=fixture_" "$NORM_CALLS"
done

ABSENT_CALLS="$TEST_ROOT/absent.calls"; ABSENT_STDIN="$TEST_ROOT/absent.stdin"
absent_rc=0
run_apply --bootstrap-roles "$ABSENT_CALLS" "$ABSENT_STDIN" "$TEST_ROOT/absent.log" "" || absent_rc=$?
if [[ "$absent_rc" -eq 0 ]]; then ok "bootstrap tolerates an absent container"; else no "bootstrap tolerates an absent container (got ${absent_rc})"; fi
check_grep "the absent container is reported, not fatal" "is not running" "$TEST_ROOT/absent.log"

DEMOTED_CALLS="$TEST_ROOT/demoted.calls"; DEMOTED_STDIN="$TEST_ROOT/demoted.stdin"
demoted_rc=0
run_apply --bootstrap-roles "$DEMOTED_CALLS" "$DEMOTED_STDIN" "$TEST_ROOT/demoted.log" "cms-database" 1 0 || demoted_rc=$?
[[ "$demoted_rc" -ne 0 ]] && ok "a demoted cmsuser refuses role bootstrap" || no "a demoted cmsuser was allowed to bootstrap"
check_grep "the refusal names NOCREATEROLE" "NOCREATEROLE" "$TEST_ROOT/demoted.log"

# ── 7. config sync generates the secrets and keeps them on a re-run ───────────────────────
printf '\n== config sync generates the credentials once and is idempotent ==\n'
NODOCKER="$TEST_ROOT/nodocker"
mkdir -p "$NODOCKER" "$TEST_ROOT/sync/config" "$TEST_ROOT/sync/admin-panel"
cat > "$NODOCKER/docker" <<'STUB'
#!/usr/bin/env bash

# No daemon: every database lookup in the sync sees "container absent" and is skipped.
if [[ "${1:-}" == "ps" ]]; then exit 0; fi
exit 1
STUB
chmod +x "$NODOCKER/docker"
cp "$EXAMPLE" "$TEST_ROOT/sync/config.toml.example"
cp "${REPO_ROOT}/config/"*.sample.toml "$TEST_ROOT/sync/config/" 2>/dev/null || true

run_sync() { # <tag>
  (
    cd "$TEST_ROOT/sync" || exit 1
    DOCKER_UID="$(id -u)" PATH="$NODOCKER:$PATH" CMS_DOCKER_ROOT="$TEST_ROOT/sync" bash "$SYNC"
  ) > "$TEST_ROOT/sync-$1.log" 2>&1
}
env_val() { awk -F= -v k="$1" '$1==k { sub(/^[^=]*=/, ""); print; exit }' "$2" 2>/dev/null; }

sync_rc=0
run_sync first || sync_rc=$?
if [[ "$sync_rc" -eq 0 ]]; then ok "the first sync exits 0"; else no "the first sync exits 0 (got ${sync_rc})"; fi
if [[ -f "$TEST_ROOT/sync/.env" ]]; then
  ok ".env was written"
  mode="$(stat -c%a "$TEST_ROOT/sync/.env" 2>/dev/null || stat -f%Lp "$TEST_ROOT/sync/.env" 2>/dev/null || echo unknown)"
  if [[ "$mode" == "600" ]]; then ok ".env is mode 600"; else no ".env is mode 600 (got ${mode})"; fi
else
  no ".env was written"
fi

declare -A first_val=()
for key in ADMIN_LOGIN_PASSWORD ADMIN_READ_PASSWORD ADMIN_SECURITY_PASSWORD; do
  value="$(env_val "$key" "$TEST_ROOT/sync/.env")"
  first_val["$key"]="$value"
  if [[ "$value" =~ ^[0-9a-f]{64}$ ]]; then
    ok ".env ${key} is a generated hex32 secret"
  else
    no ".env ${key} is a generated hex32 secret (got '${value}')"
  fi
  if grep -qE "^${key} = \"[0-9a-f]{64}\"" "$TEST_ROOT/sync/config.toml"; then
    ok "config.toml stores ${key}"
  else
    no "config.toml stores ${key}"
  fi
done

sync_rc=0
run_sync second || sync_rc=$?
if [[ "$sync_rc" -eq 0 ]]; then ok "the second sync exits 0"; else no "the second sync exits 0 (got ${sync_rc})"; fi
for key in ADMIN_LOGIN_PASSWORD ADMIN_READ_PASSWORD ADMIN_SECURITY_PASSWORD; do
  value="$(env_val "$key" "$TEST_ROOT/sync/.env")"
  if [[ -n "$value" && "$value" == "${first_val[$key]}" ]]; then
    ok "the second sync keeps ${key}"
  else
    no "the second sync keeps ${key} (was '${first_val[$key]}', now '${value}')"
  fi
done

# ── Summary ────────────────────────────────────────────────────────────────────────────────
printf '\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
