#!/usr/bin/env bash
# tests/test_update_server_backup_guard.sh — a box with no local cms-database must stop
# the update with an instruction, and must never reach the safety backup.
#
# WHY the backup is stubbed to record that it ran: the defect was an update that failed
# inside the backup with a message naming no remedy, so what this pins is that the refusal
# happens *before* the dump is attempted on a box that has nothing to dump.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

mkdir -p "$SB/bin" "$SB/scripts/__lib" "$SB/backups"
cp "${REPO_ROOT}/scripts/__update-server.sh" "${SB}/scripts/"
cp "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}/scripts/__lib/"

# docker answers "nothing is running", so cms-database is absent — the worker-box case.
printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/bin/docker"
for tool in git make curl; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/bin/${tool}"
done
printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/scripts/__preflight.sh"
cat > "${SB}/scripts/__backup.sh" <<STUB
#!/usr/bin/env bash
touch "${SB}/backup-ran"
exit 0
STUB
chmod +x "${SB}/bin/"* "${SB}/scripts/__preflight.sh" "${SB}/scripts/__backup.sh"

echo "=== a box with no local cms-database refuses with an instruction ==="
( cd "${SB}" && BACKUP_HOST_DIR="${SB}/backups" PATH="${SB}/bin:${PATH}" bash "${SB}/scripts/__update-server.sh" ) > "${SB}/run.log" 2>&1
rc=$?
[[ ${rc} -ne 0 ]] && ok "the update aborts" || no "the update exited 0"
grep -q 'no local cms-database' "${SB}/run.log" && ok "names the missing database" || no "no instruction"
grep -q "main box" "${SB}/run.log" && ok "tells the operator where to run it" || no "no remedy in the message"
[[ -e "${SB}/backup-ran" ]] && no "attempted the safety backup anyway" || ok "never reached the safety backup"

echo ""
printf 'update-server-backup-guard: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
