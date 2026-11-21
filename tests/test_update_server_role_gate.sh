#!/usr/bin/env bash
# tests/test_update_server_role_gate.sh — refuse before env/restart when role bootstrap is absent or fails.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

# The update invokes the script directly; a non-executable checkout fails before env.
if [[ -x "${REPO_ROOT}/scripts/__apply_sql.sh" ]]; then
  ok "the checked-out role bootstrap is executable"
else
  no "the checked-out role bootstrap is executable"
fi

mkdir -p "${SB}/bin" "${SB}/scripts/__lib" "${SB}/backups"
cp "${REPO_ROOT}/scripts/__update-server.sh" "${SB}/scripts/"
cp "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}/scripts/__lib/"

cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *State.Health*) printf 'healthy\n' ;;
  *Names*)        printf 'cms-database\n' ;;
  *)              : ;;
esac
exit 0
STUB
cat > "${SB}/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  rev-parse|pull) exit 0 ;;
  *)              exit 0 ;;
esac
STUB
cat > "${SB}/bin/make" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "${SB}/make.log"
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 0\n' > "${SB}/scripts/__preflight.sh"
printf '#!/usr/bin/env bash\ntouch "${SB}/backup-ran"\nexit 0\n' > "${SB}/scripts/__backup.sh"
chmod +x "${SB}/bin/"* "${SB}/scripts/__preflight.sh" "${SB}/scripts/__backup.sh"

run_update() {
  ( cd "${SB}" && BACKUP_HOST_DIR="${SB}/backups" PATH="${SB}/bin:${PATH}" \
      bash "${SB}/scripts/__update-server.sh" ) > "${SB}/run.log" 2>&1
}

echo "=== a DB-up checkout without the role bootstrap refuses before env/restart ==="
run_update
rc=$?
[[ ${rc} -ne 0 ]] && ok "the update aborts" || no "the update exited 0"
grep -q 'scripts/__apply_sql.sh missing or not executable' "${SB}/run.log" \
  && ok "names the missing role bootstrap" || no "no role-bootstrap refusal"
[[ -e "${SB}/make.log" ]] && no "make ran before the gate" || ok "no make target ran"
[[ -e "${SB}/backup-ran" ]] && no "safety backup ran" || ok "no safety backup ran"

echo ""
echo "=== a failing role bootstrap refuses before env/restart ==="
printf '#!/usr/bin/env bash\nexit 1\n' > "${SB}/scripts/__apply_sql.sh"
chmod +x "${SB}/scripts/__apply_sql.sh"
rm -f "${SB}/make.log" "${SB}/backup-ran" "${SB}/run.log"
run_update
rc=$?
[[ ${rc} -ne 0 ]] && ok "the update aborts" || no "the update exited 0"
grep -q 'Role bootstrap failed' "${SB}/run.log" \
  && ok "names the failed bootstrap" || no "no bootstrap-failure refusal"
grep -qE '^(core|admin|contest|worker|infra)$' "${SB}/make.log" 2>/dev/null \
  && no "a stack started before the gate" || ok "no stack target ran"
[[ -e "${SB}/backup-ran" ]] && no "safety backup ran" || ok "no safety backup ran"

echo ""
printf 'update-server-role-gate: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
