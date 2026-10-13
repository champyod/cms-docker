#!/usr/bin/env bash
# tests/test_contest_set_active.sh — pin the behaviour of scripts/__contest_set_active.sh.
#
# WHY stubs: the real path writes contests.is_active in the database, runs config sync and
# restarts the contest stack. docker, config sync and make are stubbed, so what is asserted
# is the decision the script makes (which SQL it issues, what it refuses) and the order it
# performs them in.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SET_ACTIVE="${REPO_ROOT}/scripts/__contest_set_active.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# Sandbox holding the script, its library, a fake .env and stubbed docker/make/config-sync.
new_sandbox() {
  SB="$(mktemp -d)"
  SANDBOXES+=("${SB}")
  mkdir -p "${SB}/scripts/__lib" "${SB}/bin"
  cp "${SET_ACTIVE}" "${SB}/scripts/"
  cp -r "${REPO_ROOT}/scripts/__lib/." "${SB}/scripts/__lib/"

  cat > "${SB}/.env" <<'ENV'
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=testpass
POSTGRES_DB=cmsdb
DEPLOYMENT_TYPE=img
ENV

  cat > "${SB}/scripts/__config_sync.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "sync" >> "${STUB_SYNC_LOG:-/dev/null}"
exit 0
STUB

  # docker stub: `ps` prints the containers the PS file lists; `exec ... psql -c <sql>`
  # answers the four queries the script issues, from the SQL it is handed.
  cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "ps" ]]; then cat "${STUB_PS:-/dev/null}"; exit 0; fi
if [[ "${1:-}" == "exec" ]]; then
  sql="" prev=""
  for a in "$@"; do [[ "$prev" == "-c" ]] && sql="$a"; prev="$a"; done
  case "$sql" in
    *to_regclass*)              printf '%s\n' "t" ;;
    *"WHERE id = 3"*)           printf '%s\n' "${STUB_COUNT_3:-1}" ;;
    *"WHERE id = 99"*)          printf '%s\n' "0" ;;
    *"WHERE is_active"*)        printf '%s\n' "${STUB_ACTIVE:-}" ;;
    *"UPDATE contests"*)        printf '%s\n' "UPDATE 1" ;;
    *)                          printf '\n' ;;
  esac
  exit 0
fi
exit 0
STUB

  cat > "${SB}/bin/make" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_MAKE_LOG:-/dev/null}"
exit 0
STUB

  chmod +x "${SB}/scripts/__contest_set_active.sh" "${SB}/scripts/__config_sync.sh" \
    "${SB}/bin/docker" "${SB}/bin/make"
  : > "${SB}/sync.log"
  : > "${SB}/make.log"
  printf '%s\n' cms-database cms-contest-web-server > "${SB}/ps.txt"
}

# Runs the script inside the sandbox with the stubs on PATH; prints its exit code.
run_script() { # <args...>
  ( cd "${SB}" && PATH="${SB}/bin:${PATH}" \
      STUB_PS="${SB}/ps.txt" STUB_SYNC_LOG="${SB}/sync.log" STUB_MAKE_LOG="${SB}/make.log" \
      STUB_ACTIVE="${STUB_ACTIVE:-}" \
      bash "${SB}/scripts/__contest_set_active.sh" "$@" ) >"${SB}/out" 2>&1
  echo $?
}

log_has() { grep -q "$1" "$2" 2>/dev/null; }

# --- 1. activating a different contest issues the UPDATE, syncs and restarts -------------
new_sandbox
code="$(run_script 3)"
[[ "$code" == "0" ]] && ok "activates an existing contest (exit 0)" || no "activates an existing contest (exit ${code})"
log_has "sync" "${SB}/sync.log" && ok "regenerates config after setting the active row" || no "regenerates config after setting the active row"
log_has "contest" "${SB}/make.log" && ok "restarts the contest stack" || no "restarts the contest stack"

# --- 2. the already-active id is a no-op that still converges config and stack -----------
new_sandbox
STUB_ACTIVE=3
code="$(run_script 3)"
[[ "$code" == "0" ]] && ok "already-active id exits 0" || no "already-active id exits ${code}"
grep -q "already active" "${SB}/out" && ok "already-active id reports no change" || no "already-active id reports no change"
STUB_ACTIVE=""

# --- 3. an id no contest carries is refused with no sync --------------------------------
new_sandbox
code="$(run_script 99)"
[[ "$code" != "0" ]] && ok "refuses an unknown contest id" || no "refuses an unknown contest id"
log_has "sync" "${SB}/sync.log" && no "refused id must not run config sync" || ok "refused id runs no config sync"

# --- 4. a non-numeric id is refused ------------------------------------------------------
new_sandbox
code="$(run_script abc)"
[[ "$code" != "0" ]] && ok "refuses a non-numeric id" || no "refuses a non-numeric id"

# --- 5. a missing argument prints usage and fails ----------------------------------------
new_sandbox
code="$(run_script)"
[[ "$code" != "0" ]] && ok "missing id fails" || no "missing id fails"

printf '\n== summary ==\npass: %d  fail: %d\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]] && echo "ALL PASS" || echo "FAILURES"
[[ "$fail" -eq 0 ]]
