#!/usr/bin/env bash
# tests/test_admin_panel_swap.sh — the blue-green panel swap, and the guards that make it safe.
#
# WHY a sandbox with stubs: the real swap starts containers, rewrites the recorded colour and
# reloads a proxy. Each of those is a stub here, so the suite proves the ORDER (the stand-in
# runs beside the old colour, and the old colour is stopped only after a request through the
# front answered) and every refusal, without a daemon, an image or nginx.
#
# WHY the refusals matter more than the happy path: a swap that reports success and then
# stops the colour the front is still dialling is a self-inflicted outage, so each failure
# below must leave the previous colour serving and running.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SWAP="${REPO_ROOT}/scripts/__admin_panel_swap.sh"
COMPOSE="${REPO_ROOT}/docker-compose.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# A repository-shaped sandbox: the swap, the colour table it sources, and stubs for the three
# things it drives — docker, the render+reload step, and the probe.
new_sandbox() {
  SB="$(mktemp -d)"
  SANDBOXES+=("${SB}")
  mkdir -p "${SB}/scripts/__lib" "${SB}/config" "${SB}/bin" "${SB}/state"
  cp "${SWAP}" "${SB}/scripts/"
  cp "${REPO_ROOT}/scripts/__admin_panel_target.sh" "${SB}/scripts/"
  cp "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}/scripts/__lib/"
  printf 'ADMIN_DOMAIN=admin.example.org\nDOMAIN_NGINX_HTTPS_PORT=443\n' > "${SB}/.env"

  # The render + nginx -t + reload step, recorded with the colour it was asked to render and
  # with what was running at that moment — the order assertion reads both back.
  cat > "${SB}/scripts/__domain_proxy_reload.sh" <<'STUB'
#!/usr/bin/env bash
colour="$(cat "$(dirname "$0")/../config/admin-panel-colour" 2>/dev/null || true)"
printf 'reload colour=%s running=%s\n' "$colour" \
  "$(tr '\n' ',' < "$(dirname "$0")/../state/running" 2>/dev/null)" >> "${SWAP_LOG}"
[[ -f "$(dirname "$0")/../state/reload-fails" ]] && exit 1
exit 0
STUB
  chmod +x "${SB}/scripts/__domain_proxy_reload.sh"

  cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "${SWAP_LOG}"
state="${SWAP_STATE}"
container_for() {
  case "$1" in
    admin-panel-next)   printf 'cms-admin-panel-next' ;;
    admin-panel-next-b) printf 'cms-admin-panel-b' ;;
    *) printf 'unknown-%s' "$1" ;;
  esac
}
case "${1:-}" in
  ps) cat "${state}/running" 2>/dev/null; exit 0 ;;
  inspect)
    name="${*: -1}"
    if grep -qx "${name}" "${state}/running" 2>/dev/null; then
      cat "${state}/health-${name}" 2>/dev/null || printf 'starting\n'
      exit 0
    fi
    printf 'none\n'
    exit 1
    ;;
  compose)
    case "$*" in
      *" up "*)
        container="$(container_for "${*: -1}")"
        grep -qx "${container}" "${state}/running" 2>/dev/null || printf '%s\n' "${container}" >> "${state}/running"
        ;;
      *" stop "*)
        container="$(container_for "${*: -1}")"
        grep -vx "${container}" "${state}/running" > "${state}/running.tmp" 2>/dev/null || true
        mv "${state}/running.tmp" "${state}/running"
        ;;
    esac
    exit 0
    ;;
esac
exit 0
STUB
  cat > "${SB}/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'probe %s\n' "$*" >> "${SWAP_LOG}"
cat "${SWAP_STATE}/probe-code" 2>/dev/null || printf '200'
STUB
  chmod +x "${SB}/bin/docker" "${SB}/bin/curl"
  : > "${SB}/state/running"
  printf '200' > "${SB}/state/probe-code"
}

# run_swap [args...] — the sandbox's swap, with the stubs first on PATH and both logs shared.
run_swap() {
  RUN_LOG="${SB}/calls.log"
  RUN_OUT="$(PATH="${SB}/bin:${PATH}" SWAP_LOG="${RUN_LOG}" SWAP_STATE="${SB}/state" \
    bash "${SB}/scripts/__admin_panel_swap.sh" "$@" 2>&1)"
  RUN_RC=$?
}

recorded_colour() { cat "${SB}/config/admin-panel-colour" 2>/dev/null || true; }
running() { tr '\n' ' ' < "${SB}/state/running"; }
not_called() { ! grep -qE -- "$1" "${SB}/calls.log" 2>/dev/null; }
line_of() { grep -nF -- "$2" "${SB}/calls.log" 2>/dev/null | head -1 | cut -d: -f1; }
before() { # <first> <second>
  local a b
  a="$(line_of x "$1")"
  b="$(line_of x "$2")"
  [[ -n "$a" && -n "$b" ]] && (( a < b ))
}

printf '\n== compose: the standby is the same panel, and it owns no host port ==\n'
anchor="$(awk '/^x-admin-panel:/,/^services:$/' "${COMPOSE}")"
if printf '%s' "${anchor}" | grep -q 'image: ghcr.io/champyod/cms-docker-admin-panel'; then
  ok "the anchor carries the panel image both colours run"
else
  no "the anchor carries the panel image both colours run"
fi
if printf '%s' "${anchor}" | grep -q 'http://localhost:3000/'; then
  ok "the anchor carries the healthcheck the swap waits on"
else
  no "the anchor carries the healthcheck the swap waits on"
fi
standby="$(awk '/^  admin-panel-next-b:/,/^  admin-web-server:/' "${COMPOSE}")"
active_block="$(awk '/^  admin-panel-next:/,/^  admin-panel-next-b:/' "${COMPOSE}")"
for pair in "a:${active_block}" "b:${standby}"; do
  colour="${pair%%:*}"
  block="${pair#*:}"
  table_name="$(. "${REPO_ROOT}/scripts/__admin_panel_target.sh"; admin_panel_container "${colour}")"
  if grep -qE "^    container_name: ${table_name}$" <<<"${block}"; then
    ok "colour ${colour}'s container name in compose is the one the table dials"
  else
    no "colour ${colour}'s container name in compose is the one the table dials (${table_name})"
  fi
done
if printf '%s' "${standby}" | grep -q 'container_name: cms-admin-panel-b'; then
  ok "the standby has its own container name"
else
  no "the standby has its own container name"
fi
if printf '%s' "${standby}" | grep -qE '^    ports:'; then
  no "the standby publishes no host port"
else
  ok "the standby publishes no host port"
fi
if printf '%s' "${standby}" | grep -q 'admin-standby'; then
  ok "the standby sits behind its own profile, so a routine deploy cannot start it"
else
  no "the standby sits behind its own profile, so a routine deploy cannot start it"
fi

printf '\n== a healthy stand-in is routed in, then the old colour is stopped ==\n'
new_sandbox
printf 'cms-admin-panel-next\n' > "${SB}/state/running"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-next"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-b"
run_swap --timeout 0
if (( RUN_RC == 0 )); then ok "the swap exits 0"; else no "the swap exits 0 (rc=${RUN_RC})"; printf '%s\n' "${RUN_OUT}"; fi
if [[ "$(recorded_colour)" == "b" ]]; then ok "the recorded colour is b"; else no "the recorded colour is b (got '$(recorded_colour)')"; fi
if before "docker compose" "reload colour=b"; then ok "the stand-in starts before the front is re-rendered"; else no "the stand-in starts before the front is re-rendered"; fi
if grep -q 'reload colour=b running=cms-admin-panel-next,' "${SB}/calls.log"; then
  ok "both colours were running when the front was pointed at b"
else
  no "both colours were running when the front was pointed at b"
fi
if before "probe " "docker compose"; then no "the probe runs only after the front is re-rendered"; else ok "the probe runs only after the front is re-rendered"; fi
if before "probe " "stop"; then ok "the old colour is stopped only after the probe answered"; else no "the old colour is stopped only after the probe answered"; fi
if before "reload colour=b" "probe "; then ok "the probe follows the flip, not the other way round"; else no "the probe follows the flip, not the other way round"; fi
if [[ "$(running)" == "cms-admin-panel-b " ]]; then ok "only colour b is left running"; else no "only colour b is left running (got '$(running)')"; fi

printf '\n== a stand-in that never becomes healthy changes nothing ==\n'
new_sandbox
printf 'cms-admin-panel-next\n' > "${SB}/state/running"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-next"
printf 'starting\n' > "${SB}/state/health-cms-admin-panel-b"
run_swap --timeout 0
if (( RUN_RC != 0 )); then ok "the swap refuses"; else no "the swap refuses"; fi
if [[ ! -f "${SB}/config/admin-panel-colour" ]]; then ok "no colour was recorded"; else no "no colour was recorded"; fi
if not_called '^reload '; then ok "the front was never re-rendered"; else no "the front was never re-rendered"; fi
if not_called ' stop '; then ok "the serving colour was not stopped"; else no "the serving colour was not stopped"; fi
if grep -q 'cms-admin-panel-next' "${SB}/state/running"; then ok "the serving colour is still running"; else no "the serving colour is still running"; fi

printf '\n== nginx rejecting the new target rolls the front back ==\n'
new_sandbox
printf 'cms-admin-panel-next\n' > "${SB}/state/running"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-next"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-b"
: > "${SB}/state/reload-fails"
run_swap --timeout 0
if (( RUN_RC != 0 )); then ok "the swap refuses"; else no "the swap refuses"; fi
if [[ "$(recorded_colour)" == "a" ]]; then ok "the recorded colour is back to a"; else no "the recorded colour is back to a (got '$(recorded_colour)')"; fi
if grep -q 'reload colour=a' "${SB}/calls.log"; then ok "the rollback re-renders colour a"; else no "the rollback re-renders colour a"; fi
if not_called ' stop '; then ok "the serving colour was not stopped"; else no "the serving colour was not stopped"; fi
if grep -q 'cms-admin-panel-next' "${SB}/state/running"; then ok "the serving colour is still running"; else no "the serving colour is still running"; fi

printf '\n== a failed probe rolls the front back ==\n'
new_sandbox
printf 'cms-admin-panel-next\n' > "${SB}/state/running"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-next"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-b"
printf '502' > "${SB}/state/probe-code"
run_swap --timeout 0
if (( RUN_RC != 0 )); then ok "the swap refuses"; else no "the swap refuses"; fi
if [[ "$(recorded_colour)" == "a" ]]; then ok "the recorded colour is back to a"; else no "the recorded colour is back to a (got '$(recorded_colour)')"; fi
if grep -q 'reload colour=a' "${SB}/calls.log"; then ok "the rollback re-renders colour a"; else no "the rollback re-renders colour a"; fi
if not_called ' stop '; then ok "the serving colour was not stopped"; else no "the serving colour was not stopped"; fi
if grep -q 'reload colour=b' "${SB}/calls.log"; then ok "the front was pointed at the new colour first"; else no "the front was pointed at the new colour first"; fi

printf '\n== a second run swaps back without breaking anything ==\n'
new_sandbox
printf 'cms-admin-panel-next\n' > "${SB}/state/running"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-next"
printf 'healthy\n' > "${SB}/state/health-cms-admin-panel-b"
run_swap --timeout 0
first_rc="${RUN_RC}"
run_swap --timeout 0
if (( first_rc == 0 && RUN_RC == 0 )); then ok "both runs succeed"; else no "both runs succeed (${first_rc}, ${RUN_RC})"; fi
if [[ "$(recorded_colour)" == "a" ]]; then ok "the second run records colour a again"; else no "the second run records colour a again (got '$(recorded_colour)')"; fi
if [[ "$(running)" == "cms-admin-panel-next " ]]; then ok "exactly one colour is running, and it is the recorded one"; else no "exactly one colour is running, and it is the recorded one (got '$(running)')"; fi
if [[ "$(grep -c '^docker .* up ' "${SB}/calls.log")" -eq 2 ]]; then ok "each run started exactly one stand-in"; else no "each run started exactly one stand-in"; fi

printf '\n== no colour running is a refusal, not a cold start ==\n'
new_sandbox
printf '200' > "${SB}/state/probe-code"
run_swap --timeout 0
if (( RUN_RC != 0 )); then ok "the swap refuses"; else no "the swap refuses"; fi
if not_called '^docker .* (up|stop) '; then ok "nothing was started or stopped"; else no "nothing was started or stopped"; fi

printf '\n== a recorded colour that is not a|b is fatal ==\n'
new_sandbox
printf 'cms-admin-panel-next\n' > "${SB}/state/running"
printf 'zz\n' > "${SB}/config/admin-panel-colour"
run_swap --timeout 0
if (( RUN_RC != 0 )); then ok "the swap refuses"; else no "the swap refuses"; fi
if grep -q 'zz' <<< "${RUN_OUT}"; then ok "the refusal names the bad value"; else no "the refusal names the bad value"; fi
if not_called '^docker .* up '; then ok "nothing was started"; else no "nothing was started"; fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "${pass}" "${fail}"
[[ "${fail}" -eq 0 ]] && printf 'ALL PASS\n'
[[ "${fail}" -eq 0 ]]
