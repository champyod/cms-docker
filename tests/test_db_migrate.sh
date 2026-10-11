#!/usr/bin/env bash
# tests/test_db_migrate.sh — pin the preconditions, the step order and the verdict
# scripts/__db_migrate.sh reaches.
#
# WHY stubs: every real path needs a live container and would run two make
# targets against a real database. Both are stubbed, so what is asserted is the
# decision the script makes — which case hard-fails, which proceeds, in what
# order — rather than what postgres does.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DB_MIGRATE="${REPO_ROOT}/scripts/__db_migrate.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# --- stubs -----------------------------------------------------------------
# docker answers the probes the script makes (presence, running, database
# exists, marker table, RLS state) and logs the -U/-d it was asked to use;
# make logs the targets it was asked to run.
install_stubs() {
  cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  inspect)
    if [[ "${2:-}" == "-f" ]]; then printf '%s\n' "${STUB_RUNNING:-true}"; exit 0; fi
    for a in "$@"; do [[ "$a" == "${STUB_DOWN:-__none__}" ]] && exit 1; done
    exit 0
    ;;
  exec)
    prev=""
    for a in "$@"; do
      case "$prev" in
        -U) printf '%s\n' "$a" >> "${STUB_PSQL_LOG:-/dev/null}" ;;
        -d) printf '%s\n' "$a" >> "${STUB_PSQL_LOG:-/dev/null}" ;;
      esac
      prev="$a"
    done
    for a in "$@"; do
      case "$a" in
        *pg_database*)    printf '%s\n' "${STUB_DB_EXISTS:-1}"; exit 0 ;;
        *to_regclass*)    printf '%s\n' "${STUB_MARKER:-t}";     exit 0 ;;
        *relrowsecurity*) printf '%s\n' "${STUB_RLS:-_prisma_migrations}"; exit 0 ;;
      esac
    done
    printf 'ok\n'
    exit 0
    ;;
esac
exit 0
STUB
  cat > "${SB}/bin/make" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "${STUB_MAKE_LOG:-/dev/null}"
exit 0
STUB
  chmod +x "${SB}/bin/docker" "${SB}/bin/make"
}

# --- fixtures --------------------------------------------------------------
new_sandbox() {
  SB="$(mktemp -d)"
  SANDBOXES+=("${SB}")
  mkdir -p "${SB}/scripts/__lib" "${SB}/bin"
  cp "${DB_MIGRATE}" "${SB}/scripts/"
  cp "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}/scripts/__lib/"
  install_stubs
  : > "${SB}/make.log"
  : > "${SB}/psql.log"
}

write_env() { # <db> <user> <password>
  cat > "${SB}/.env" <<EOF
POSTGRES_DB="$1"
POSTGRES_USER="$2"
POSTGRES_PASSWORD="$3"
POSTGRES_PORT=5433
EOF
}

write_config() { # <active-profile>
  cat > "${SB}/config.toml" <<EOF
[core]
ACTIVE_DATABASE = "$1"

[db_default]
POSTGRES_DB = "cmsdb"

[db_evaluate]
POSTGRES_DB = "cmsdb_evaluate"
EOF
}

# Runs the copied script with the stubs first on PATH. Stub behaviour is set by
# the caller exporting a STUB_* variable first — never as a prefix on this
# function call, because a prefix assignment in front of a bash function can
# outlive it and leak into the next case. Leaves OUT and RC.
run_migrate() {
  OUT="$(PATH="${SB}/bin:${PATH}" STUB_MAKE_LOG="${SB}/make.log" STUB_PSQL_LOG="${SB}/psql.log" \
    bash "${SB}/scripts/__db_migrate.sh" "$@" 2>&1)"
  RC=$?
}

has() { if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then ok "$1"; else no "$1 (missing: $2)"; fi; }
hasnt() { if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then no "$1 (present: $2)"; else ok "$1"; fi; }

# --- 1. the non-mutating entry points --------------------------------------
printf '\n== --help and --dry-run touch nothing ==\n'
new_sandbox
OUT="$(bash "${SB}/scripts/__db_migrate.sh" --help 2>&1)"; RC=$?
if [[ "$RC" -eq 0 ]]; then ok "--help exits 0"; else no "--help exits 0 (got ${RC})"; fi
has "help names the authorisation variable" "CONFIRM_DB_MIGRATE=yes"

run_migrate --dry-run
if [[ "$RC" -eq 0 ]]; then ok "--dry-run exits 0"; else no "--dry-run exits 0 (got ${RC})"; fi
has "dry run prints the base-schema step" "make cms-init"
has "dry run prints the history step" "make prisma-sync"
if [[ -s "${SB}/make.log" ]]; then no "dry run does not run make"; else ok "dry run does not run make"; fi
if grep -q . "${SB}/psql.log"; then no "dry run does not touch docker"; else ok "dry run does not touch docker"; fi

OUT="$(bash "${SB}/scripts/__db_migrate.sh" --nope 2>&1)"; RC=$?
if [[ "$RC" -eq 1 ]]; then ok "an unknown argument is refused with exit 1"; else no "an unknown argument is refused with exit 1 (got ${RC})"; fi

# --- 2. the hard-fail preconditions ----------------------------------------
printf '\n== each precondition that must refuse, and what it tells you to run ==\n'
new_sandbox
write_config default
write_env cmsdb cmsuser "secretpass"
rm -f "${SB}/.env"
run_migrate
if [[ "$RC" -eq 1 ]]; then ok "a missing .env is refused"; else no "a missing .env is refused (got ${RC})"; fi
has "and names ./cms config sync as the remedy" "./cms config sync"

new_sandbox
write_config default
printf 'POSTGRES_DB="cmsdb"\nPOSTGRES_USER="cmsuser"\nPOSTGRES_PASSWORD=""\n' > "${SB}/.env"
run_migrate
if [[ "$RC" -eq 1 ]]; then ok "an empty password is refused"; else no "an empty password is refused (got ${RC})"; fi
has "and names ./cms config sync as the remedy" "./cms config sync"

new_sandbox
write_config default
write_env cmsdb cmsuser "secretpass"
export STUB_DOWN=cms-database
run_migrate
unset STUB_DOWN
if [[ "$RC" -eq 1 ]]; then ok "a stopped cms-database is refused"; else no "a stopped cms-database is refused (got ${RC})"; fi
has "and names make core as the remedy" "make core"

new_sandbox
write_env cmsdb_evaluate cmsuser "secretpass"
cat > "${SB}/config.toml" <<'EOF'
[core]
ACTIVE_DATABASE = "staging"

[db_default]
POSTGRES_DB = "cmsdb"
EOF
run_migrate
if [[ "$RC" -eq 1 ]]; then ok "an active profile with no [db_*] section is refused"; else no "an active profile with no [db_*] section is refused (got ${RC})"; fi
has "and points at ./cms db use" "./cms db use"

new_sandbox
write_config default
write_env cmsdb cmsuser "secretpass"
cat > "${SB}/config.toml" <<'EOF'
[core]
ACTIVE_DATABASE = "default"

[db_default]
POSTGRES_HOST = "database"
EOF
run_migrate
if [[ "$RC" -eq 1 ]]; then ok "a profile without POSTGRES_DB is refused"; else no "a profile without POSTGRES_DB is refused (got ${RC})"; fi
has "and names ./cms config sync as the remedy" "./cms config sync"

new_sandbox
write_config evaluate
write_env cmsdb_evaluate cmsuser "secretpass"
export STUB_DB_EXISTS=0
run_migrate
unset STUB_DB_EXISTS
if [[ "$RC" -eq 1 ]]; then ok "a database that does not exist is refused"; else no "a database that does not exist is refused (got ${RC})"; fi
has "and names ./cms db create as the remedy" "./cms db create"
has "and names ./cms db use as the follow-up" "./cms db use"

printf '\n== a non-interactive run cannot confirm on its own ==\n'
new_sandbox
write_config default
write_env cmsdb cmsuser "secretpass"
run_migrate
if [[ "$RC" -eq 1 ]]; then ok "no terminal and no CONFIRM_DB_MIGRATE is refused"; else no "no terminal and no CONFIRM_DB_MIGRATE is refused (got ${RC})"; fi
has "and the refusal shows the exact re-run command" "CONFIRM_DB_MIGRATE=yes"
if [[ -s "${SB}/make.log" ]]; then no "nothing ran before the confirmation"; else ok "nothing ran before the confirmation"; fi

# --- 3. the happy path, in order -------------------------------------------
printf '\n== the migration runs the two steps in order, against the custom database ==\n'
new_sandbox
write_config evaluate
cp "${SB}/config.toml" "${SB}/config.toml.before"
write_env cmsdb_evaluate customuser "secretpass"
export CONFIRM_DB_MIGRATE=yes
run_migrate
if [[ "$RC" -eq 0 ]]; then ok "an authorised run exits 0"; else no "an authorised run exits 0 (got ${RC})"; fi
order="$(tr '\n' ' ' < "${SB}/make.log")"
if [[ "$order" == "cms-init prisma-sync " ]]; then ok "cms-init runs before prisma-sync and nothing else runs"; else no "step order was '${order}'"; fi
has "the base schema was applied" "cms-init (base schema) OK"
has "the history and RLS were applied" "prisma-sync (roles, migration history, RLS, permissions) OK"
has "the run reports verification" "RLS is enabled and forced"
if grep -qx "cmsdb_evaluate" "${SB}/psql.log"; then ok "the custom database name was the one queried"; else no "the custom database name was the one queried"; fi
if grep -qx "customuser" "${SB}/psql.log"; then ok "the custom user was the one used"; else no "the custom user was the one used"; fi
if cmp -s "${SB}/config.toml" "${SB}/config.toml.before"; then ok "config.toml is byte-identical afterwards"; else no "config.toml is byte-identical afterwards"; fi
unset CONFIRM_DB_MIGRATE

# --- 4. the verdict is checked, not assumed --------------------------------
printf '\n== a database that did not really migrate fails ==\n'
new_sandbox
write_config default
write_env cmsdb cmsuser "secretpass"
export STUB_RLS=$'contests\nadmins'
export CONFIRM_DB_MIGRATE=yes
run_migrate
if [[ "$RC" -eq 1 ]]; then ok "an RLS gap exits 1"; else no "an RLS gap exits 1 (got ${RC})"; fi
has "and names the gap" "RLS gap"
has "and names the exempt table" "_prisma_migrations"
unset STUB_RLS

new_sandbox
write_config default
write_env cmsdb cmsuser "secretpass"
export STUB_MARKER=f
run_migrate
if [[ "$RC" -eq 1 ]]; then ok "a missing base schema exits 1"; else no "a missing base schema exits 1 (got ${RC})"; fi
has "and blames the base schema step" "cms-init"
unset STUB_MARKER CONFIRM_DB_MIGRATE

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
