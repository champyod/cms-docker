#!/usr/bin/env bash
# scripts/__audit_restore_proof.sh — restore a backup's audit archive into a scratch database and
# prove the hash chain survived.
#
# WHY this exists: D3's third question was "can an operator prove the chain is intact after a
# restore", and the honest answer before this script was "nobody has tried". A backup that is never
# restored is a hope, and an audit archive that is never restored is a hope about the one artifact
# that exists nowhere else. This runs the whole loop — checksum, restore, verify — and exits
# non-zero on any step that cannot be shown to have worked.
#
# WHAT it never touches: the live database. The archive goes into a database this script creates
# (name suffixed with the run's timestamp) and drops again; the audit tables are created there
# `LIKE` the live ones so the data restore has somewhere to land. RLS is deliberately not created on
# the scratch copy: the verifier must be able to read it, and the property under test is the chain,
# not the policies (those are pinned by tests/test_audit_log_durability.sh and the RLS suites).
#
# Usage:
#   scripts/__audit_restore_proof.sh [--dump <path>] [--keep] [--scratch-name <name>]
#
#   --dump          the audit archive to restore (default: newest backups/db/audit-log-*.dump)
#   --keep          leave the scratch database behind for inspection (it is dropped otherwise)
#   --scratch-name  override the generated scratch database name
#
# Exit codes: 0 the archive restored and the chain verified; 1 anything else. A missing archive, a
# checksum mismatch, a failed restore and an unreadable log are all 1 — they are all "not proven".
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/__lib/common.sh
source "${SCRIPT_DIR}/__lib/common.sh"

DB_CONTAINER="${CMS_DB_CONTAINER:-cms-database}"
PANEL_CONTAINER="${CMS_PANEL_CONTAINER:-cms-admin-panel-next}"
BACKUP_DIR="${BACKUP_HOST_DIR:-${REPO_ROOT}/backups}/db"

DUMP=""
KEEP=0
SCRATCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --scratch-name) SCRATCH="${2:-}"; shift 2 ;;
    --help|-h) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) log_die "unknown argument: $1" 2 ;;
  esac
done

command -v docker >/dev/null 2>&1 || log_die "docker CLI not found" 1
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || log_die "database container '$DB_CONTAINER' is not present" 1

# Resolve the archive.
if [[ -z "$DUMP" ]]; then
  DUMP="$(ls -1t "${BACKUP_DIR}"/audit-log-*.dump 2>/dev/null | head -n1 || true)"
fi
[[ -n "$DUMP" && -f "$DUMP" ]] || log_die "no audit archive found in ${BACKUP_DIR} — take a backup first (make backup)" 1
[[ -f "${DUMP}.sha256" ]] || log_die "no checksum beside ${DUMP} — refusing to restore an unverifiable archive" 1

expected_sha="$(awk '{print $1}' "${DUMP}.sha256")"
actual_sha="$(sha256sum -- "$DUMP" | awk '{print $1}')"
[[ "$expected_sha" == "$actual_sha" ]] || log_die "checksum mismatch for $(basename -- "$DUMP") — the archive is corrupt, do not restore it" 1
log_info "checksum ok: $(basename -- "$DUMP") sha256=${actual_sha:0:16}…"

# Credentials: the same .env the rest of the tooling reads.
env_get() {
  awk -F= -v k="$1" '$1==k { sub(/^[^=]*=/, "", $0); print; exit }' "${REPO_ROOT}/.env" 2>/dev/null | tr -d '\r'
}
DB_NAME="${POSTGRES_DB:-$(env_get POSTGRES_DB)}"
DB_NAME="${DB_NAME:-cmsdb}"
DB_USER="${POSTGRES_USER:-$(env_get POSTGRES_USER)}"
DB_USER="${DB_USER:-cmsuser}"
DB_PASS="${POSTGRES_PASSWORD:-$(env_get POSTGRES_PASSWORD)}"
[[ -n "$DB_PASS" ]] || log_die "POSTGRES_PASSWORD is empty — cannot reach the database container" 1

SCRATCH="${SCRATCH:-cms_audit_proof_$(date -u +%Y%m%d%H%M%S)}"
[[ "$SCRATCH" =~ ^[a-z][a-z0-9_]*$ ]] || log_die "scratch database name must be lowercase letters, digits and underscores: $SCRATCH" 1

scratch_psql() { docker_exec_db "$DB_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$SCRATCH" -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  if (( KEEP == 0 )); then
    docker_exec_db "$DB_PASS" "$DB_CONTAINER" \
      psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true
  else
    log_warn "scratch database kept: ${SCRATCH} (drop it with: DROP DATABASE \"${SCRATCH}\")"
  fi
}
trap cleanup EXIT

# WHY creation is allowed to fail with an instruction instead of a retry: no role on this cluster
# holds CREATEDB (the bootstrap superuser was demoted by 20260912000500_owner_hardening), so a new
# database always needs `./cms db create`, which runs in single-user mode with the container
# stopped. Guessing at that here would either restart the stack or silently point the restore at the
# live database; naming the command is the only honest answer.
if ! docker_exec_db "$DB_PASS" "$DB_CONTAINER" \
      psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$SCRATCH'" 2>/dev/null | grep -q 1; then
  log_info "creating scratch database ${SCRATCH} …"
  if ! docker_exec_db "$DB_PASS" "$DB_CONTAINER" \
        psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH\"" >/dev/null 2>&1; then
    KEEP=1
    log_die "could not create ${SCRATCH}: ${DB_USER} holds no CREATEDB. Create it first, then re-run with --scratch-name ${SCRATCH}:
    CONFIRM_DB_ADMIN=yes scripts/__db_admin.sh create ${SCRATCH}
Nothing was restored." 1
  fi
fi

# The archive carries the table definitions too, so the scratch database needs no shells: the
# restore creates them exactly as they were dumped, columns and defaults included.

log_info "restoring $(basename -- "$DUMP") into ${SCRATCH} …"
# WHY a TOC filter and not a plain restore: the archive carries the tables' RLS policies and guard
# triggers, which reference helper functions (`cms_actor_is_staff`, `cms_audit_log_guard`) that live
# in the live database, not in the archive. Restoring into a bare scratch database they fail, and
# "restore partly worked" is not a verdict anybody can act on. Policy and trigger entries are
# therefore excluded BY TYPE — the property under test is the data and its chain, and both are
# restored in full. The exclusion list is explicit, so a new object type cannot slip through.
container_dump="/tmp/cms-audit-proof-$$.dump"
docker exec "$DB_CONTAINER" rm -f "$container_dump" 2>/dev/null || true
docker cp -- "$DUMP" "${DB_CONTAINER}:${container_dump}" >/dev/null \
  || log_die "could not stage the archive in ${DB_CONTAINER} — nothing was restored" 1
toc="$(mktemp "${TMPDIR:-/tmp}/cms-audit-toc.XXXXXX")"
if ! docker exec "$DB_CONTAINER" pg_restore -l "$container_dump" > "$toc"; then
  docker exec "$DB_CONTAINER" rm -f "$container_dump" 2>/dev/null || true
  log_die "pg_restore -l could not read $(basename -- "$DUMP") — the archive is not a valid custom-format dump" 1
fi
filtered="$(mktemp "${TMPDIR:-/tmp}/cms-audit-toc-filtered.XXXXXX")"
# ROW SECURITY is excluded with POLICY for a reason worth stating: the archive carries
# `ENABLE/FORCE ROW LEVEL SECURITY` but the policies that make it readable are filtered out, and
# RLS-with-no-policy is deny-all — the rows would restore and then be invisible, which reads exactly
# like "the backup is empty". The scratch copy is a forensics copy, not a serving database.
grep -vE ' (POLICY|TRIGGER|FK CONSTRAINT|ACL|COMMENT|ROW SECURITY) ' "$toc" > "$filtered" || true
docker cp -- "$filtered" "${DB_CONTAINER}:${container_dump}.toc" >/dev/null || log_die "could not stage the restore plan" 1
restore_rc=0
docker_exec_db "$DB_PASS" "$DB_CONTAINER" \
  pg_restore -U "$DB_USER" -d "$SCRATCH" --no-owner --no-privileges \
  -L "${container_dump}.toc" "$container_dump" || restore_rc=$?
docker exec "$DB_CONTAINER" rm -f "$container_dump" "${container_dump}.toc" 2>/dev/null || true
rm -f -- "$toc" "$filtered"
if (( restore_rc != 0 )); then
  log_die "pg_restore failed (status ${restore_rc}) — the archive did not restore, so nothing is proven" 1
fi

rows="$(scratch_psql -tAc 'SELECT count(*) FROM public.audit_log')"
anchors="$(scratch_psql -tAc 'SELECT count(*) FROM public.audit_log_retention')"
log_info "restored ${rows} audit row(s) and ${anchors} retention anchor(s)"

# Verify with the panel's own code. The container is the pinned copy of admin-panel/src/lib/
# audit-chain.ts; a host bun is the fallback when the panel is not running.
scratch_url="postgresql://${DB_USER}:${DB_PASS}@database:5432/${SCRATCH}"
scratch_url_host="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${POSTGRES_PORT:-5432}/${SCRATCH}"

verify_rc=1
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PANEL_CONTAINER"; then
  log_info "verifying the restored chain in ${PANEL_CONTAINER} …"
  if docker exec -e "DATABASE_URL=$scratch_url" "$PANEL_CONTAINER" \
      ./node_modules/.bin/tsx scripts/audit-log.ts verify; then
    verify_rc=0
  fi
elif command -v bun >/dev/null 2>&1; then
  log_warn "no ${PANEL_CONTAINER} — verifying with the host bun against ${scratch_url_host}"
  if ( cd "${REPO_ROOT}/admin-panel" && DATABASE_URL="$scratch_url_host" bun run scripts/audit-log.ts verify ); then
    verify_rc=0
  fi
else
  log_die "no verifier available: start the panel (make admin) or install bun" 1
fi

if (( verify_rc != 0 )); then
  log_die "the restored audit chain did NOT verify — the archive is a copy of a log that was already broken, or the restore mangled it" 1
fi

(( rows > 0 )) || log_warn "the archive restored zero rows — the chain verified, but it proved nothing about this backup"
log_info "restore proof complete: $(basename -- "$DUMP") restores and its chain verifies"
