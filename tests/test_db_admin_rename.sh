#!/usr/bin/env bash
# tests/test_db_admin_rename.sh — pin the statements `__db_admin.sh rename` runs.
#
# WHY dry-run is the seam: the real path needs a live container and drops
# sessions, so the SQL is asserted through --dry-run, which prints the same
# variables the real path executes in the same order.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DB_ADMIN="${REPO_ROOT}/scripts/__db_admin.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

OUT="$(cd "$REPO_ROOT" && bash "$DB_ADMIN" rename cmsdb cmsdb_evaluate --dry-run 2>&1)"
RC=$?

check_has() { # <label> <substring>
  if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then ok "$1"; else no "$1 (missing: $2)"; fi
}
check_absent() { # <label> <substring>
  if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then no "$1 (present: $2)"; else ok "$1"; fi
}
line_of() { # <substring> — first matching line number, empty when absent
  printf '%s\n' "$OUT" | grep -Fn -- "$1" | head -1 | cut -d: -f1
}
check_before() { # <label> <first substring> <second substring>
  local first second
  first="$(line_of "$2")"
  second="$(line_of "$3")"
  if [[ -n "$first" && -n "$second" && "$first" -lt "$second" ]]; then
    ok "$1"
  else
    no "$1 (line ${first:-?} is not before ${second:-?})"
  fi
}

printf '\n== rename --dry-run exits clean ==\n'
if [[ "$RC" -eq 0 ]]; then ok "rename --dry-run exits 0"; else no "rename --dry-run exits 0 (got ${RC})"; fi

printf '\n== the statement the rename applies, in single-user mode ==\n'
check_has "it says the cluster is stopped" 'single-user mode'
check_has "it names the stop" 'is stopped'
check_has "it renames in one statement" 'ALTER DATABASE "cmsdb" RENAME TO "cmsdb_evaluate";'
check_absent "the per-session ALLOW_CONNECTIONS dance is gone" 'ALLOW_CONNECTIONS'
check_absent "nothing terminates backend sessions" 'pg_terminate_backend'

printf '\n== the create is one statement, owned by the application role ==\n'
OUT_CREATE="$(cd "$REPO_ROOT" && POSTGRES_USER= bash "$DB_ADMIN" create cmsdb_evaluate --dry-run 2>&1)"
check_create_has() {
  if printf '%s\n' "$OUT_CREATE" | grep -Fq -- "$2"; then ok "$1"; else no "$1 (missing: $2)"; fi
}
check_create_has "it creates the database owned by POSTGRES_USER" 'CREATE DATABASE "cmsdb_evaluate" OWNER "cmsuser";'
check_create_has "the create explains the single-user stop" 'single-user mode'
check_create_has "it says the cluster is stopped" 'is stopped'

printf '\n== a rename onto the same name is refused ==\n'
if (cd "$REPO_ROOT" && bash "$DB_ADMIN" rename cmsdb cmsdb --dry-run) >/dev/null 2>&1; then
  no "rename cmsdb cmsdb is refused"
else
  ok "rename cmsdb cmsdb is refused"
fi

# The profile report only exists after a successful rename, and --dry-run never
# gets there, so the cases below run the real path against a throwaway copy of
# the script and a docker stub. Nothing here can reach the checkout's own
# config.toml or a real database.
SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

sandbox() {
  local dir
  dir="$(mktemp -d)"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts/__lib" "${dir}/bin"
  cp "${DB_ADMIN}" "${dir}/scripts/"
  cp "${REPO_ROOT}/scripts/__lib/common.sh" "${dir}/scripts/__lib/"
  # WHY a stub: the claims are about config.toml, and a real container would mean
  # a real database. It answers what the script asks — is the container running,
  # what image and PGDATA does it carry, does the name exist, and does the
  # stop/single-user/start sequence the rotation now depends on complete.
  # STUB_LOG records the argv of every call so a test can assert the order.
  cat > "${dir}/bin/docker" <<'STUB'
#!/usr/bin/env bash
[[ -n "${STUB_LOG:-}" ]] && printf '%s\n' "$*" >> "${STUB_LOG}"
case "${1:-}" in
  inspect)
    case "${3:-}" in
      '{{.State.Running}}') printf 'true\n' ;;
      '{{.Config.Image}}') printf 'postgres:15\n' ;;
      '{{range .Config.Env}}{{println .}}{{end}}') printf 'PGDATA=/var/lib/postgresql/data\n' ;;
      *) printf 'true\n' ;;
    esac
    exit 0
    ;;
  stop|start)
    exit 0
    ;;
  run)
    # The one-off single-user container: echo the SQL it was fed on stdin, and
    # record it too, so a test can assert which statement reached single-user mode.
    if [[ "${STUB_RUN_FAIL:-0}" == "1" ]]; then
      cat >/dev/null
      printf 'ERROR:  permission denied to rename database\n'
      exit 1
    fi
    cat | tee -a "${STUB_LOG:-/dev/null}"
    [[ -n "${STUB_AFTER_MARKER:-}" ]] && : > "${STUB_AFTER_MARKER}"
    printf 'ALTER DATABASE\n'
    exit 0
    ;;
  exec)
    for arg in "$@"; do
      case "$arg" in
        *FROM\ pg_database*datname*)
          if [[ -f "${STUB_AFTER_MARKER:-/nonexistent}" ]]; then
            [[ "$arg" == *"'"${STUB_AFTER_DB:-}"'"* ]] && printf '1\n' || printf '0\n'
          else
            [[ "$arg" == *"'"${STUB_PRESENT_DB}"'"* ]] && printf '1\n' || printf '0\n'
          fi
          exit 0
          ;;
      esac
    done
    printf 'ALTER DATABASE\n'
    exit 0
    ;;
esac
exit 0
STUB
  chmod +x "${dir}/bin/docker"
  printf '%s' "${dir}"
}

# Runs the real rename path in a sandbox, leaving OUT and RC for the shared
# check_has/check_absent helpers. CONFIRM_DB_ADMIN=yes answers the confirmation
# a non-interactive run cannot type.
run_case() { # <config.toml body, empty for no file>  -> OUT, RC
  local dir
  dir="$(sandbox)"
  if [[ -n "$1" ]]; then printf '%s\n' "$1" > "${dir}/config.toml"; fi
  OUT="$(PATH="${dir}/bin:${PATH}" CONFIRM_DB_ADMIN=yes STUB_PRESENT_DB=cmsdb \
    STUB_AFTER_DB=cmsdb_evaluate STUB_AFTER_MARKER="${dir}/after" \
    STUB_LOG="${dir}/docker.log" \
    bash "${dir}/scripts/__db_admin.sh" rename cmsdb cmsdb_evaluate 2>&1)"
  RC=$?
  SANDBOX_DIR="${dir}"
}

printf '\n== a rename names every profile still pointing at the old database ==\n'
run_case '[core]
ACTIVE_DATABASE = "default"

[db_default]
POSTGRES_HOST = "database"
POSTGRES_DB = "cmsdb"
POSTGRES_USER = "cmsuser"

[db_evaluate]
POSTGRES_DB = "cmsdb"

[db_scratch]
POSTGRES_DB = "cmsdb_evaluate"
'
check_has "the rename still reports success" 'renamed "cmsdb" to "cmsdb_evaluate"'
check_has "the count of stale profiles is reported" '(2 found):'
check_has "db_default is named" '    db_default'
check_has "db_evaluate is named" '    db_evaluate'
check_absent "a profile already on the new name is not listed" 'db_scratch'
check_has "the repoint instruction survives" 'point them at "cmsdb_evaluate" in config.toml'
if [[ "$RC" -eq 0 ]]; then ok "the rename exits 0"; else no "the rename exits 0 (got ${RC})"; fi

printf '\n== rename writes neither config.toml nor .env ==\n'
run_case '[db_default]
POSTGRES_DB = "cmsdb"
'
if [[ "$(cksum < "${SANDBOX_DIR}/config.toml")" == "$(cksum <<< '[db_default]
POSTGRES_DB = "cmsdb"
')" ]]; then
  ok "config.toml is byte-identical after the rename"
else
  no "config.toml is byte-identical after the rename"
fi
if [[ ! -e "${SANDBOX_DIR}/.env" ]]; then ok "no .env is written"; else no "no .env is written"; fi

printf '\n== a value that is not a plain quoted string is never counted ==\n'
run_case '[db_bare]
POSTGRES_DB = cmsdb

[db_spaced]
POSTGRES_DB = "cmsdb renamed"

[db_trailing]
POSTGRES_DB = "cmsdb "     # a space inside the quotes is part of the value

[db_comment]
POSTGRES_DB = "cmsdb"      # str; a trailing comment is not part of the value
'
check_has "only the one exact match is counted" '(1 found):'
check_has "the counted profile is the commented one" '    db_comment'
check_absent "a bare word is not counted" 'db_bare'
check_absent "a value containing a space is not counted" 'db_spaced'
check_absent "a value with a trailing space is not counted" 'db_trailing'

printf '\n== nothing points at the old name ==\n'
run_case '[db_default]
POSTGRES_DB = "cmsdb_evaluate"

[db_evaluate]
POSTGRES_DB = "cmsdb_evaluate"
'
check_has "zero stale profiles reads as reassuring" 'no db_<profile> section in config.toml points at "cmsdb"'
check_absent "no count is reported when there is nothing to fix" 'found):'
if [[ "$RC" -eq 0 ]]; then ok "the rename exits 0"; else no "the rename exits 0 (got ${RC})"; fi

printf '\n== a machine with no config.toml is not a failed rename ==\n'
run_case ''
check_has "the rename still reports success" 'renamed "cmsdb" to "cmsdb_evaluate"'
check_has "the undeterminable case says so" 'config.toml is missing or unreadable'
check_absent "it does not claim zero stale profiles" 'no db_<profile> section in config.toml points at'
check_absent "it does not invent a count" 'found):'
if [[ "$RC" -eq 0 ]]; then ok "the rename exits 0"; else no "the rename exits 0 (got ${RC})"; fi

printf '\n== the cluster is stopped, the statement applied, and started again ==\n'
run_case '[db_default]
POSTGRES_DB = "cmsdb"
'
log="${SANDBOX_DIR}/docker.log"
seq="$(sed -n 's/^\(stop\|run\|start\) .*/\1/p' "${log}" | tr '\n' ' ')"
if [[ "$seq" == "stop run start " ]]; then
  ok "the sequence is stop -> single-user -> start"
else
  no "the sequence is stop -> single-user -> start (got '${seq}')"
fi
if grep -Fq -- '--single' "${log}"; then ok "the statement is applied in --single mode"; else no "the statement is applied in --single mode"; fi
if grep -Fq -- '--user postgres' "${log}"; then ok "the one-off container runs as the postgres user (the server refuses root)"; else no "the one-off container runs as the postgres user"; fi
if grep -Fq -- '--volumes-from cms-database' "${log}"; then ok "it reuses the container's own volume"; else no "it reuses the container's own volume"; fi
if grep -Fq -- 'exit_on_error=on' "${log}"; then ok "a failed statement is made fatal"; else no "a failed statement is made fatal"; fi
if grep -Fq 'ALTER DATABASE "cmsdb" RENAME TO "cmsdb_evaluate";' "${log}"; then
  ok "the rename statement reaches single-user mode"
else
  no "the rename statement reaches single-user mode"
fi
check_has "and the run reports the rename" 'renamed "cmsdb" to "cmsdb_evaluate"'

printf '\n== a failed statement still leaves the container running ==\n'
FAIL_DIR="$(sandbox)"
printf '[db_default]\nPOSTGRES_DB = "cmsdb"\n' > "${FAIL_DIR}/config.toml"
OUT="$(PATH="${FAIL_DIR}/bin:${PATH}" CONFIRM_DB_ADMIN=yes STUB_PRESENT_DB=cmsdb \
  STUB_RUN_FAIL=1 STUB_LOG="${FAIL_DIR}/docker.log" \
  bash "${FAIL_DIR}/scripts/__db_admin.sh" rename cmsdb cmsdb_evaluate 2>&1)"
RC=$?
fail_log="${FAIL_DIR}/docker.log"
if [[ "$RC" -ne 0 ]]; then ok "a failed statement exits non-zero"; else no "a failed statement exits non-zero (got ${RC})"; fi
check_has "the failure is reported, not swallowed" 'RENAME failed'
if grep -q '^start cms-database' "${fail_log}"; then
  ok "cms-database is started again after the failure"
else
  no "cms-database is started again after the failure"
fi
if grep -q 'renamed "cmsdb"' <<<"$OUT"; then no "a failed rename does not claim success"; else ok "a failed rename does not claim success"; fi

printf '\n== a statement that silently does nothing is caught ==\n'
PROBE_DIR="$(sandbox)"
printf '[db_default]\nPOSTGRES_DB = "cmsdb"\n' > "${PROBE_DIR}/config.toml"
OUT="$(PATH="${PROBE_DIR}/bin:${PATH}" CONFIRM_DB_ADMIN=yes STUB_PRESENT_DB=cmsdb \
  STUB_AFTER_DB=cmsdb STUB_AFTER_MARKER="${PROBE_DIR}/after" \
  STUB_LOG="${PROBE_DIR}/docker.log" \
  bash "${PROBE_DIR}/scripts/__db_admin.sh" rename cmsdb cmsdb_evaluate 2>&1)"
RC=$?
if [[ "$RC" -eq 1 ]]; then ok "a rename that did not move the name exits 1"; else no "a rename that did not move the name exits 1 (got ${RC})"; fi
check_has "and says the name was not moved" "not moved"
if grep -q 'renamed "cmsdb"' <<<"$OUT"; then no "a no-op rename does not claim success"; else ok "a no-op rename does not claim success"; fi

printf '\n== a create that leaves no database is caught ==\n'
CREATE_DIR="$(sandbox)"
printf '[db_default]\nPOSTGRES_DB = "cmsdb"\n' > "${CREATE_DIR}/config.toml"
OUT="$(PATH="${CREATE_DIR}/bin:${PATH}" CONFIRM_DB_ADMIN=yes STUB_PRESENT_DB=__none__ \
  STUB_AFTER_DB=__none__ STUB_AFTER_MARKER="${CREATE_DIR}/after" \
  STUB_LOG="${CREATE_DIR}/docker.log" \
  bash "${CREATE_DIR}/scripts/__db_admin.sh" create cmsdb_new 2>&1)"
RC=$?
if [[ "$RC" -eq 1 ]]; then ok "a create that left no database exits 1"; else no "a create that left no database exits 1 (got ${RC})"; fi
check_has "and says the database is absent" "absent"

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
