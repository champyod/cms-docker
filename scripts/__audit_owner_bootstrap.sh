#!/usr/bin/env bash
# scripts/__audit_owner_bootstrap.sh — the one-time owner separation for `audit_log`.
#
# WHY this is a separate, manual script and not part of the migration: a guard trigger is only as
# strong as the role that owns the table. The owner of `audit_log` may `ALTER TABLE ... DISABLE
# TRIGGER`, `NO FORCE ROW LEVEL SECURITY` or `ALTER FUNCTION ... OWNER`, and no trigger can refuse
# its own table's owner — so the application role must stop being the owner. Two things are needed
# for that, and neither is available to a migration:
#
#   · `CREATE ROLE cms_audit_owner` needs CREATEROLE. The bootstrap superuser (`cmsuser`) was demoted
#     by migration 20260912000500_owner_hardening and no role holds CREATEROLE on this cluster.
#   · `ALTER TABLE ... OWNER TO` needs the current owner to be able to SET ROLE to the new owner, or a
#     superuser.
#
# The only route to superuser on this cluster is `postgres --single` with the container stopped —
# the same route `./cms db create|rename` already uses (docs/DB-ROTATION.md, "WHY single-user
# mode"). So this is a maintenance-window step, it is idempotent, and it verifies its own outcome.
#
# WHAT it does, in one single-user session:
#   1. CREATE ROLE cms_audit_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
#   2. ALTER TABLE  public.audit_log            OWNER TO cms_audit_owner
#   3. ALTER FUNCTION public.cms_audit_log_guard, cms_audit_log_statement_guard,
#      cms_audit_anchor_guard, cms_audit_retention_days, cms_audit_retention_cutoff,
#      cms_audit_prune(integer)                OWNER TO cms_audit_owner
#   4. GRANT the app role back exactly the DML it needs (SELECT/INSERT, DELETE for the prune path)
#
# After it, `cmsuser` answering "disable the trigger" gets `must be owner of table audit_log`.
# `make audit-verify` reports `owner_separated` and stops exiting 2 on the ownership check.
#
# Usage:
#   CONFIRM_AUDIT_OWNER=yes scripts/__audit_owner_bootstrap.sh     (or: make audit-owner-bootstrap CONFIRM=1)
#   scripts/__audit_owner_bootstrap.sh --dry-run                    print the plan, touch nothing
#
# Exit codes: 0 the separation is in force (or was already); 1 refused or failed — the container is
# restarted in either case.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/__lib/common.sh
source "${SCRIPT_DIR}/__lib/common.sh"

DB_CONTAINER="${CMS_DB_CONTAINER:-cms-database}"
OWNER_ROLE="cms_audit_owner"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes) CONFIRM_AUDIT_OWNER=yes ;;
    --help|-h) sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) log_die "unknown argument: $arg" 2 ;;
  esac
done

require_docker() { command -v docker >/dev/null 2>&1 || log_die "docker CLI not found" 1; }

load_env() {
  env_get() { awk -F= -v k="$1" '$1==k { sub(/^[^=]*=/, "", $0); print; exit }' "${REPO_ROOT}/.env" 2>/dev/null | tr -d '\r'; }
  POSTGRES_DB="${POSTGRES_DB:-$(env_get POSTGRES_DB)}"; POSTGRES_DB="${POSTGRES_DB:-cmsdb}"
  POSTGRES_USER="${POSTGRES_USER:-$(env_get POSTGRES_USER)}"; POSTGRES_USER="${POSTGRES_USER:-cmsuser}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(env_get POSTGRES_PASSWORD)}"
}

container_image() { docker inspect -f '{{.Config.Image}}' "$DB_CONTAINER" 2>/dev/null; }
container_pgdata() {
  local v
  v="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB_CONTAINER" 2>/dev/null \
    | awk -F= '$1=="PGDATA" {sub(/^[^=]*=/,""); print; exit}')"
  printf '%s' "${v:-/var/lib/postgresql/data}"
}

# Single-user mode treats a newline as a statement terminator, so every statement is one line and
# `exit_on_error=on` makes a failure fatal instead of a silently partial apply.
plan_sql() {
  cat <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN CREATE ROLE ${OWNER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END \$\$;
ALTER TABLE public.audit_log OWNER TO ${OWNER_ROLE};
ALTER FUNCTION public.cms_audit_log_guard() OWNER TO ${OWNER_ROLE};
ALTER FUNCTION public.cms_audit_log_statement_guard() OWNER TO ${OWNER_ROLE};
ALTER FUNCTION public.cms_audit_anchor_guard() OWNER TO ${OWNER_ROLE};
ALTER FUNCTION public.cms_audit_retention_days() OWNER TO ${OWNER_ROLE};
ALTER FUNCTION public.cms_audit_retention_cutoff() OWNER TO ${OWNER_ROLE};
ALTER FUNCTION public.cms_audit_prune(integer) OWNER TO ${OWNER_ROLE};
GRANT SELECT, INSERT, DELETE ON TABLE public.audit_log TO ${POSTGRES_USER};
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO ${POSTGRES_USER};
GRANT SELECT, INSERT ON TABLE public.audit_log_retention TO ${POSTGRES_USER};
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_retention_id_seq TO ${POSTGRES_USER};
SQL
}

# The outcome, read back through a normal connection. The whole point of the script is this line:
# the object owner must no longer be the application role.
verify_outcome() {
  local owner fn_owner
  owner="$(docker_exec_db "${POSTGRES_PASSWORD:-}" "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='audit_log'" 2>/dev/null | tr -d '[:space:]')"
  fn_owner="$(docker_exec_db "${POSTGRES_PASSWORD:-}" "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.cms_audit_log_guard()'::regprocedure" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$owner" == "$OWNER_ROLE" && "$fn_owner" == "$OWNER_ROLE" ]]; then
    log_info "owner separation in force: audit_log and its guard functions are owned by ${OWNER_ROLE}"
    return 0
  fi
  log_warn "owner separation NOT in force (audit_log owner='${owner:-?}', guard function owner='${fn_owner:-?}')"
  return 1
}

require_docker
load_env

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || log_die "database container '$DB_CONTAINER' is not present" 1

if verify_outcome >/dev/null 2>&1; then
  verify_outcome
  exit 0
fi

if (( DRY_RUN == 1 )); then
  log_info "dry run — with confirmation this would stop ${DB_CONTAINER} and apply:"
  plan_sql
  log_info "then start ${DB_CONTAINER} again and verify the owner."
  exit 0
fi

if [[ "${CONFIRM_AUDIT_OWNER:-no}" != "yes" ]]; then
  if [[ ! -t 0 ]]; then
    {
      echo "REFUSED: this stops ${DB_CONTAINER} (single-user mode) and there is no terminal to confirm on."
      echo "To authorise it deliberately: CONFIRM_AUDIT_OWNER=yes $0"
    } >&2
    exit 1
  fi
  printf 'Type "yes" to stop %s briefly and separate the audit_log owner: ' "$DB_CONTAINER"
  read -r answer || answer=""
  [[ "$answer" == "yes" ]] || { echo "Aborted. Nothing was changed." >&2; exit 1; }
fi

image="$(container_image)"
pgdata="$(container_pgdata)"
[[ -n "$image" ]] || log_die "could not read the image of '$DB_CONTAINER'" 1

STOPPED=0
restart_container() {
  (( STOPPED == 1 )) || return 0
  STOPPED=0
  log_info "starting ${DB_CONTAINER} again …"
  docker start "$DB_CONTAINER" >/dev/null 2>&1 || { log_warn "could not start ${DB_CONTAINER} — start it by hand"; return 1; }
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "$DB_CONTAINER" pg_isready -q >/dev/null 2>&1; then
      log_info "${DB_CONTAINER} is accepting connections again."
      return 0
    fi
    sleep 0.5
  done
  log_warn "${DB_CONTAINER} is not reporting ready — check: docker logs ${DB_CONTAINER}"
  return 1
}
trap 'restart_container || true' EXIT

log_warn "stopping ${DB_CONTAINER} — single-user mode needs the cluster down."
docker stop "$DB_CONTAINER" >/dev/null || log_die "could not stop ${DB_CONTAINER} — nothing was changed" 1
STOPPED=1

rc=0
if ! plan_sql | docker run --rm -i --volumes-from "$DB_CONTAINER" --user postgres \
      --entrypoint postgres "$image" --single -c exit_on_error=on -D "$pgdata" "$POSTGRES_DB"; then
  rc=1
fi

restart_container || rc=1

(( rc == 0 )) || log_die "the single-user apply failed — see the output above; ${DB_CONTAINER} was started again" 1
verify_outcome || log_die "the apply reported success but the owner did not change — nothing is in force" 1
log_info "done. 'make audit-verify' no longer reports the owner as the application role."
