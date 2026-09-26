#!/bin/bash
set +x +v
set -euo pipefail
umask 077

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

preflight() {
  local tool version name
  [[ -n ${COMMANDCODE_SCRATCHPAD:-} ]] || fail 'COMMANDCODE_SCRATCHPAD must be set'
  [[ $COMMANDCODE_SCRATCHPAD = /* && -d $COMMANDCODE_SCRATCHPAD && -w $COMMANDCODE_SCRATCHPAD ]] || fail 'Scratchpad must be an existing writable absolute directory'
  (( EUID != 0 )) || fail 'Run as an unprivileged user; sudo is not supported'
  for tool in /bin/initdb /bin/pg_ctl /bin/postgres /bin/psql; do
    [[ -x $tool ]] || fail "Missing $tool"
    version=$("$tool" --version)
    [[ $version =~ PostgreSQL\)\ ([0-9]+)\.([0-9]+) ]] || fail "Unrecognized version: $tool"
    (( BASH_REMATCH[1] >= 18 )) || fail "PostgreSQL 18 or newer required: $tool"
    if [[ $tool == /bin/postgres ]]; then
      server_version=$((BASH_REMATCH[1] * 10000 + BASH_REMATCH[2]))
    fi
    printf '%s\n' "$version"
  done
  for tool in openssl mktemp chmod rm; do
    command -v "$tool" >/dev/null || fail "Missing $tool"
  done
  [[ -d /proc/self/cwd ]] || fail 'Linux /proc/self/cwd is required for short private socket paths'
  for name in ${!PG@}; do unset "$name"; done
  unset CMS_AUDIT_WRITER_PASSWORD
  export LC_ALL=C PGCONNECT_TIMEOUT=5
  sql=$(cd -- "${BASH_SOURCE[0]%/*}/.." && printf '%s/audit_second_store.sql' "$PWD")
  [[ -r $sql ]] || fail 'Setup SQL is unreadable'
}

cleanup() {
  local status=$?
  trap - EXIT
  trap '' HUP INT TERM
  if [[ -n ${work:-} && -d $work ]]; then
    if [[ -f $work/data/postmaster.pid ]]; then
      if ! /bin/pg_ctl -D "$work/data" -m fast -w -t 30 stop >/dev/null 2>&1; then
        printf 'Cleanup could not confirm shutdown; private directory retained: %s\n' "$work" >&2
        exit 1
      fi
    elif [[ ${starting:-false} == true ]]; then
      printf 'Startup state uncertain; private directory retained: %s\n' "$work" >&2
      exit 1
    fi
    [[ ! -f $work/data/postmaster.pid ]] || exit 1
    cd -- "$COMMANDCODE_SCRATCHPAD"
    rm -rf -- "$work"
  fi
  exit "$status"
}

start_cluster() {
  work=$(mktemp -d "$COMMANDCODE_SCRATCHPAD/audit-second.XXXXXXXX")
  chmod 700 "$work"
  /bin/initdb -D "$work/data" -U audit_test_admin --auth-local=trust --auth-host=reject --no-locale >"$work/init.log" 2>&1
  chmod 700 "$work/data"
  printf '%s\n' 'local all cms_audit_writer scram-sha-256' 'local all audit_test_admin trust' 'local all all reject' 'host all all 0.0.0.0/0 reject' 'host all all ::/0 reject' >"$work/data/pg_hba.conf"
  printf '%s\n' "listen_addresses = ''" "unix_socket_directories = '/proc/self/cwd'" 'unix_socket_permissions = 0700' 'port = 55432' 'shared_buffers = 16MB' 'max_connections = 10' 'work_mem = 1MB' 'maintenance_work_mem = 16MB' 'max_wal_size = 64MB' 'min_wal_size = 32MB' "log_statement = 'none'" "log_min_error_statement = 'panic'" "log_min_messages = 'panic'" >"$work/data/postgresql.conf"
  starting=true
  /bin/pg_ctl -D "$work/data" -l "$work/server.log" -w -t 30 start >/dev/null 2>&1
  starting=false
}

admin() {
  local database=$1
  shift
  (cd -- "$work/data" && /bin/psql -X -w -h /proc/self/cwd -p 55432 -U audit_test_admin -d "$database" -Atq -v ON_ERROR_STOP=1 -v ECHO=none -v ECHO_HIDDEN=off "$@")
}

writer() {
  (cd -- "$work/data" && PGPASSWORD=$password /bin/psql -X -w -h /proc/self/cwd -p 55432 -U cms_audit_writer -d cms_audit -Atq -v ON_ERROR_STOP=1 -v VERBOSITY=verbose "$@")
}

setup() {
  admin postgres "$@" -f "$sql" >/dev/null 2>&1
}

assert_admin() {
  [[ $(admin "$1" -c "$2") == "$3" ]] || fail "$4"
}

assert_absent() {
  assert_admin postgres "SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cms_audit_writer') AND NOT EXISTS (SELECT FROM pg_database WHERE datname='cms_audit')" t 'Setup created a role or database before validation'
}

test_opt_in() {
  setup || fail 'Missing opt-in should skip successfully'
  assert_absent
  if setup -v audit_second_store_setup=false; then fail 'False opt-in succeeded'; fi
  assert_absent
  if setup -v audit_second_store_setup=true; then fail 'Missing password succeeded'; fi
  assert_absent
  if CMS_AUDIT_WRITER_PASSWORD='' setup -v audit_second_store_setup=true; then fail 'Empty password succeeded'; fi
  assert_absent
}

test_new_database_failure() {
  admin postgres -c 'ALTER DATABASE template0 ALLOW_CONNECTIONS true'
  admin template0 -c 'CREATE TABLE public.audit_log (id text)'
  admin postgres -c 'ALTER DATABASE template0 ALLOW_CONNECTIONS false'
  if CMS_AUDIT_WRITER_PASSWORD=$password setup -v audit_second_store_setup=true; then fail 'Invalid new database schema succeeded'; fi
  assert_admin postgres "SELECT datconnlimit FROM pg_database WHERE datname='cms_audit'" 0 'Failed new database did not retain connection limit zero'
  assert_admin postgres "SELECT count(*) FROM pg_roles WHERE rolname='cms_audit_writer'" 0 'Failed new database created writer'
  admin postgres -c 'DROP DATABASE cms_audit'
  admin postgres -c 'ALTER DATABASE template0 ALLOW_CONNECTIONS true'
  admin template0 -c 'DROP TABLE public.audit_log'
  admin postgres -c 'ALTER DATABASE template0 ALLOW_CONNECTIONS false'
  assert_absent
}

reject_password() {
  local saved=$password output
  password=$1
  if writer -c 'SELECT 1' >"$work/rejection" 2>&1; then fail 'Invalid password authenticated'; fi
  output=$(<"$work/rejection")
  [[ $output == *'password authentication failed for user "cms_audit_writer"'* ]] || fail 'Authentication failed for an unexpected reason'
  password=$saved
}

check_role() {
  assert_admin cms_audit "SELECT rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit) FROM pg_roles WHERE rolname='cms_audit_writer'" t 'Unsafe writer attributes'
  assert_admin cms_audit "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname='cms_audit_writer'" 0 'Writer has role memberships'
  assert_admin cms_audit "SELECT datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_database WHERE datname=current_database()" t 'Unexpected database owner'
  assert_admin cms_audit "SELECT relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_class WHERE oid='public.audit_log'::regclass" t 'Unexpected table owner'
  assert_admin cms_audit "SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolname='cms_audit_writer'" t 'Writer verifier is not SCRAM'
  assert_admin postgres "SELECT datconnlimit FROM pg_database WHERE datname='cms_audit'" -1 'Successful setup did not open new database'
}

denied() {
  local output
  if writer -c "$1" >"$work/denial" 2>&1; then fail "Operation unexpectedly allowed: $2"; fi
  output=$(<"$work/denial")
  [[ $output == *'ERROR:  42501:'* ]] || fail "Expected SQLSTATE 42501: $2"
  [[ -z ${3:-} || $output == *"$3"* ]] || fail "Unexpected permission failure: $2"
}

test_permissions() {
  writer -c "INSERT INTO public.audit_log (id,verb,entity,result,reason) VALUES (9001,'create','test','ok','retained')" >/dev/null
  [[ $(writer -c "SELECT id || ':' || reason FROM public.audit_log") == '9001:retained' ]] || fail 'Writer SELECT or explicit-id INSERT failed'
  denied "UPDATE public.audit_log SET reason='changed' WHERE id=9001" UPDATE
  denied 'DELETE FROM public.audit_log WHERE id=9001' DELETE
  denied 'TRUNCATE public.audit_log' TRUNCATE
  denied 'CREATE TABLE public.forbidden (id int)' 'CREATE TABLE'
  denied 'CREATE TEMP TABLE forbidden (id int)' 'CREATE TEMP TABLE'
  denied 'ALTER TABLE public.audit_log ADD COLUMN forbidden int' ALTER
  denied 'DROP TABLE public.audit_log' DROP
  denied "INSERT INTO public.audit_log (verb,entity,result) VALUES ('create','test','ok')" 'INSERT without id' 'permission denied for sequence audit_log_id_seq'
}

fingerprint() {
  admin cms_audit -c "SELECT md5(rolpassword) FROM pg_authid WHERE rolname='cms_audit_writer'"
}

snapshot() {
  admin cms_audit -c 'SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_log a'
}

test_rotation() {
  local old=$password before verifier
  before=$(snapshot)
  verifier=$(fingerprint)
  admin cms_audit -c 'GRANT UPDATE(reason) ON public.audit_log TO cms_audit_writer'
  assert_admin cms_audit "SELECT has_column_privilege('cms_audit_writer','public.audit_log','reason','UPDATE')" t 'Column grant injection failed'
  writer -c "UPDATE public.audit_log SET reason=reason WHERE id=9001" >/dev/null
  password=$(openssl rand -hex 32)
  CMS_AUDIT_WRITER_PASSWORD=$password setup -v audit_second_store_setup=true || fail 'Password rotation failed'
  [[ $(writer -c 'SELECT 1') == 1 ]] || fail 'Rotated password did not authenticate'
  reject_password "$old"
  [[ $(fingerprint) != "$verifier" && $(snapshot) == "$before" ]] || fail 'Rotation failed to change verifier or preserve data'
  assert_admin cms_audit "SELECT has_column_privilege('cms_audit_writer','public.audit_log','reason','UPDATE')" f 'Rerun retained column UPDATE'
  denied "UPDATE public.audit_log SET reason='changed' WHERE id=9001" 'Column UPDATE after rerun'
  check_role
}

test_schema_mismatch() {
  local before verifier candidate
  before=$(snapshot)
  verifier=$(fingerprint)
  candidate=$(openssl rand -hex 32)
  admin cms_audit -c 'ALTER TABLE public.audit_log ALTER COLUMN reason TYPE text'
  if CMS_AUDIT_WRITER_PASSWORD=$candidate setup -v audit_second_store_setup=true; then fail 'Schema mismatch succeeded'; fi
  [[ $(fingerprint) == "$verifier" && $(snapshot) == "$before" ]] || fail 'Schema mismatch changed password or data'
  [[ $(writer -c 'SELECT 1') == 1 ]] || fail 'Schema failure invalidated existing password'
  reject_password "$candidate"
}

work=''
preflight
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
start_cluster
assert_admin postgres 'SHOW server_version_num' "$server_version" 'Runtime server differs from installed postgres binary'
test_opt_in
password=$(openssl rand -hex 32)
test_new_database_failure
CMS_AUDIT_WRITER_PASSWORD=$password setup -v audit_second_store_setup=true || fail 'Initial setup failed'
[[ $(writer -c 'SELECT current_user') == cms_audit_writer ]] || fail 'Writer SCRAM login failed'
reject_password "$(openssl rand -hex 32)"
check_role
test_permissions
test_rotation
test_schema_mismatch
printf 'PASS: isolated audit second-store tests\n'
