#!/usr/bin/env bash
# tests/test_update_server_ordering.sh — the update path must apply the Prisma schema
# sync BEFORE it restarts any service stack, and must refuse before starting anything
# when the database its schema lives in is not up.
#
# WHY this pins an order rather than a message: the 2026-10-15 incident was not a wrong
# message — the update reported green — it was that cms-ranking-web-server booted against
# an un-migrated schema, cached the failed board load, and stayed 503. The only thing that
# prevents a recurrence is that `make cms-init` / `make prisma-sync` are recorded before the
# first stack target, so this suite reads the order the commands were actually issued in.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

mkdir -p "${SB}/bin" "${SB}/scripts/__lib" "${SB}/backups"
cp "${REPO_ROOT}/scripts/__update-server.sh" "${SB}/scripts/"
cp "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}/scripts/__lib/"

# A database that answers every probe: the update only proceeds past the backup on a box
# whose cms-database is up, and the post-update verify reads the same container's health.
cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *State.Health*) printf 'healthy\n' ;;
  *Names*)        printf 'cms-database\ncms-admin-panel-next\ncms-ranking-web-server\ncms-contest-web-server\n' ;;
  *) : ;;
esac
exit 0
STUB

# `make` records each target it was asked for, in order — the sequence under test.
cat > "${SB}/bin/make" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "${SB}/make.log"
exit 0
STUB

for tool in git curl; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/bin/${tool}"
done
printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/scripts/__preflight.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/scripts/__backup.sh"
# The real sync renders from the registry and would fail without a config; the ordering
# between the schema sync and the stack restart is what this suite reads.
printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/scripts/__config_sync.sh"
chmod +x "${SB}/bin/"* "${SB}/scripts/"*.sh

first_line() { # <file> <ere>
  grep -nE "$2" "$1" 2>/dev/null | head -n1 | cut -d: -f1
}

# ---------------------------------------------------------------------------
echo "=== the schema sync is issued before the first stack restart ==="
# ---------------------------------------------------------------------------
( cd "${SB}" && BACKUP_HOST_DIR="${SB}/backups" PATH="${SB}/bin:${PATH}" \
    bash "${SB}/scripts/__update-server.sh" ) > "${SB}/run.log" 2>&1
rc=$?
[[ ${rc} -eq 0 ]] && ok "the update completes" || { no "the update exited ${rc}"; sed 's/^/        /' "${SB}/run.log"; }

migrate_line="$(first_line "${SB}/run.log" 'Syncing database schema via Prisma Migrate')"
restart_line="$(first_line "${SB}/run.log" '\[UPDATE\] Restarting services\.\.\.')"
[[ -n "${migrate_line}" ]] && ok "the schema sync runs" || no "the schema sync never ran"
if [[ -n "${migrate_line}" && -n "${restart_line}" && "${migrate_line}" -lt "${restart_line}" ]]; then
  ok "the sync is logged before 'Restarting services' (${migrate_line} < ${restart_line})"
else
  no "the sync is not before the restart (sync=${migrate_line:-none} restart=${restart_line:-none})"
fi

sync_cmd_line="$(first_line "${SB}/make.log" '^prisma-sync$')"
init_cmd_line="$(first_line "${SB}/make.log" '^cms-init$')"
stack_cmd_line="$(first_line "${SB}/make.log" '(^| )(core|admin|contest|infra|worker)$')"
[[ -n "${init_cmd_line}" ]] && ok "make cms-init ran" || no "make cms-init did not run"
[[ -n "${sync_cmd_line}" ]] && ok "make prisma-sync ran" || no "make prisma-sync did not run"
if [[ -n "${sync_cmd_line}" && -n "${stack_cmd_line}" && "${sync_cmd_line}" -lt "${stack_cmd_line}" ]]; then
  ok "no stack target is started before prisma-sync (${sync_cmd_line} < ${stack_cmd_line})"
else
  no "a stack target was started before prisma-sync (sync=${sync_cmd_line:-none} stack=${stack_cmd_line:-none})"
fi
if [[ -n "${stack_cmd_line}" ]]; then
  ok "a stack restart still follows the sync"
else
  no "no stack was ever restarted"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== with no database up, the sync refuses before any stack starts ==="
# ---------------------------------------------------------------------------
# The backup step above also refuses a box with no local database, so its script is
# removed here: the schema-sync guard is then the one that has to stop the run.
rm -f "${SB}/scripts/__backup.sh"
rm -f "${SB}/make.log"
: > "${SB}/run.log"
cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "${SB}/bin/docker"

( cd "${SB}" && BACKUP_HOST_DIR="${SB}/backups" PATH="${SB}/bin:${PATH}" \
    bash "${SB}/scripts/__update-server.sh" ) > "${SB}/run.log" 2>&1
rc=$?
[[ ${rc} -ne 0 ]] && ok "the update aborts" || no "the update exited 0"
grep -q 'its schema cannot be synced' "${SB}/run.log" \
  && ok "names the un-migrated schema as the reason" || no "no schema-sync refusal"
grep -qE '(^| )(core|admin|contest|infra|worker)$' "${SB}/make.log" 2>/dev/null \
  && no "a stack was started anyway" || ok "no stack target was started"

echo ""
printf 'update-server-ordering: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
