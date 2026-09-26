#!/bin/bash
set +x +v
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../../.." && pwd)
CRATE_DIR=$REPO_ROOT/backend
SQL=$REPO_ROOT/admin-panel/prisma/sql/audit_second_store.sql

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT
  trap '' HUP INT TERM
  if [[ -n ${work:-} && -d $work ]]; then
    if [[ -f $work/data/postmaster.pid ]]; then
      if ! /bin/pg_ctl -D "$work/data" -m fast -w -t 30 stop >/dev/null 2>&1; then
        printf 'Cleanup could not confirm shutdown; retained: %s\n' "$work" >&2
        exit 1
      fi
    elif [[ ${starting:-false} == true ]]; then
      printf 'Startup state uncertain; retained: %s\n' "$work" >&2
      exit 1
    fi
    cd -- "${COMMANDCODE_SCRATCHPAD:?}"
    rm -rf -- "$work"
  fi
  exit "$status"
}

issue_certificate() {
  local dir=$1
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -subj '/CN=audit-test-ca' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -keyout "$dir/ca.key" -out "$dir/ca.crt" >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' \
    -keyout "$dir/server.key" -out "$dir/server.csr" >/dev/null 2>&1
  openssl x509 -req -in "$dir/server.csr" -days 2 \
    -CA "$dir/ca.crt" -CAkey "$dir/ca.key" -CAcreateserial \
    -extfile <(printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n') \
    -out "$dir/server.crt" >/dev/null 2>&1
}

start_tls_cluster() {
  work=$(mktemp -d "$COMMANDCODE_SCRATCHPAD/audit-writer.XXXXXXXX")
  chmod 700 "$work"
  issue_certificate "$work"
  chmod 600 "$work/server.key" "$work/server.crt" "$work/ca.key" "$work/ca.crt"
  /bin/initdb -D "$work/data" -U audit_test_admin --auth-local=trust --auth-host=reject --no-locale >"$work/init.log" 2>&1
  chmod 700 "$work/data"
  {
    printf '%s\n' 'local all cms_audit_writer scram-sha-256' 'local all audit_test_admin trust' 'local all all reject'
    printf 'hostssl all all 127.0.0.1/32 scram-sha-256\n'
    printf 'hostssl all all ::1/128 scram-sha-256\n'
  } >"$work/data/pg_hba.conf"
  {
    printf '%s\n' "listen_addresses = '127.0.0.1'" "unix_socket_directories = '/proc/self/cwd'" 'unix_socket_permissions = 0700'
    printf 'port = 55433\n'
    printf "ssl = on\nssl_cert_file = '%s'\nssl_key_file = '%s'\n" "$work/server.crt" "$work/server.key"
    printf '%s\n' 'shared_buffers = 16MB' 'max_connections = 10' 'work_mem = 1MB' 'maintenance_work_mem = 16MB'
    printf '%s\n' 'max_wal_size = 64MB' 'min_wal_size = 32MB' "log_statement = 'none'" "log_min_error_statement = 'panic'"
  } >"$work/data/postgresql.conf"
  starting=true
  /bin/pg_ctl -D "$work/data" -l "$work/server.log" -w -t 30 start >/dev/null 2>&1
  starting=false
}

psql_admin() {
  (cd -- "$work/data" && /bin/psql -X -w -h /proc/self/cwd -p 55433 -U audit_test_admin -d "$1" -Atq -v ON_ERROR_STOP=1 "${@:2}")
}

main() {
  [[ -n ${COMMANDCODE_SCRATCHPAD:-} && -d $COMMANDCODE_SCRATCHPAD ]] || fail 'COMMANDCODE_SCRATCHPAD must be set'
  [[ -r $SQL ]] || fail 'Provisioning SQL is unreadable'
  (( EUID != 0 )) || fail 'Run unprivileged; sudo is unsupported'
  for tool in /bin/initdb /bin/pg_ctl /bin/postgres /bin/psql openssl mktemp; do
    [[ -x $tool ]] || command -v "$tool" >/dev/null || fail "Missing $tool"
  done
  for name in ${!PG@}; do unset "$name"; done

  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  start_tls_cluster

  local password
  password=$(openssl rand -hex 32)
  CMS_AUDIT_WRITER_PASSWORD=$password psql_admin postgres \
    -v audit_second_store_setup=1 -f "$SQL" >/dev/null 2>&1 || fail 'Provisioning failed'

  CMS_AUDIT_TEST_HOST=localhost \
  CMS_AUDIT_TEST_PORT=55433 \
  CMS_AUDIT_TEST_DATABASE=cms_audit \
  CMS_AUDIT_TEST_USER=cms_audit_writer \
  CMS_AUDIT_TEST_PASSWORD=$password \
  SSL_CERT_FILE=$work/ca.crt \
  CMS_AUDIT_REQUIRE_CA=$work/ca.crt \
    cargo test --manifest-path "$CRATE_DIR/Cargo.toml" -p cms-audit --test store -- --nocapture \
    || fail 'Writer integration test failed against the TLS store'

  printf 'PASS: cms-audit writer verified against an isolated TLS store\n'
}

main
