#!/usr/bin/env bash
# tests/test_service_wiring_render.sh — pin scripts/__config_sync.sh's wiring render step.
#
# WHY the real renderer behind a stub database: the SQL belongs to the stub, but the
# generated routes must come from the shipped service-wiring-cli, so this test fails
# when the script and the renderer disagree about the payload shape.
#
# WHY the stub is generated with its sandbox path substituted in: the stub then reads
# the payload from a file the test wrote, so nothing here depends on whether an
# environment variable survives into the stub's own process.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SYNC="${REPO_ROOT}/scripts/__config_sync.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

PAYLOAD='{"services":[{"id":1,"name":"cms-contest-web-server-1","role":"ContestWebServer","shard":0,"host":"web-1","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":7,"enabled":true}],"wirings":[],"exposures":[{"contest_id":7,"hostname":"a.example.com","path":"/","tls":true,"tailnet":"cms-7"}]}'

# $1 exposures, $2 services-table ("t"|"f")
new_sandbox() {
  SB="$(mktemp -d)"
  SANDBOXES+=("${SB}")
  mkdir -p "${SB}/config" "${SB}/admin-panel/src/lib" "${SB}/bin" "${SB}/scripts/__lib"
  cp "${REPO_ROOT}/config.toml.example" "${SB}/config.toml.example"
  cp "${REPO_ROOT}/config/cms.sample.toml" "${SB}/config/" 2>/dev/null || true
  cp "${SYNC}" "${SB}/scripts/"
  cp -r "${REPO_ROOT}/scripts/__lib/." "${SB}/scripts/__lib/"
  # The renderer is dependency-free, so the real modules run without node_modules.
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring.ts" "${SB}/admin-panel/src/lib/"
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring-render.ts" "${SB}/admin-panel/src/lib/"
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring-cli.ts" "${SB}/admin-panel/src/lib/"
  printf '%s' "${PAYLOAD}" > "${SB}/payload.json"

  cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "ps" ]]; then printf '%s\n' "cms-database"; exit 0; fi
if [[ "${1:-}" == "exec" ]]; then
  sql=""; prev=""
  for a in "$@"; do [[ "$prev" == "-c" ]] && sql="$a"; prev="$a"; done
  case "$sql" in
    *to_regclass*services*) printf '%s\n' "@SERVICES_TABLE@" ;;
    *"count(*) FROM contest_exposures"*) printf '%s\n' "@EXPOSED@" ;;
    *json_build_object*) cat "@PAYLOAD_FILE@" ;;
    *"DISTINCT db_profile"*) printf '%s\n' "default" ;;
    *to_regclass*) printf '%s\n' "t" ;;
    *"WHERE is_active"*) printf '%s\n' "7" ;;
    *) printf '\n' ;;
  esac
  exit 0
fi
exit 0
STUB
  sed -i -e "s|@SERVICES_TABLE@|${2:-t}|" -e "s|@EXPOSED@|${1:-1}|" \
    -e "s|@PAYLOAD_FILE@|${SB}/payload.json|" "${SB}/bin/docker"
  chmod +x "${SB}/bin/docker"
}

run_sync() {
  CMS_DOCKER_ROOT="${SB}" PATH="${SB}/bin:${PATH}" bash "${SYNC}" > "${SB}/sync.log" 2>&1
}

echo "=== Test 1: rows present renders the generated route artifacts ==="
new_sandbox 1 t
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
grep -q 'server_name a.example.com;' "${SB}/config/generated/contest-routes.conf" 2>/dev/null \
  && ok "renders the contest server block" || no "missing contest server block"
grep -q 'proxy_pass http://web-1:8888;' "${SB}/config/generated/contest-routes.conf" 2>/dev/null \
  && ok "proxies to the registered upstream" || no "wrong or missing upstream"
grep -q 'AllowFunnel' "${SB}/config/generated/tailscale-serve.json" 2>/dev/null \
  && ok "renders the tailnet serve config" || no "missing tailnet serve config"

echo ""
echo "=== Test 2: nothing exposed leaves the N=1 path untouched ==="
new_sandbox 0 t
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0 with no exposures" || no "sync exit ${rc}"
[[ -e "${SB}/config/generated" ]] && no "wrote artifacts with nothing exposed" \
  || ok "wrote no artifacts with nothing exposed"

echo ""
echo "=== Test 3: an absent registry table is a no-op, not a failure ==="
new_sandbox 1 f
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0 without the table" || no "sync exit ${rc}"
[[ -e "${SB}/config/generated" ]] && no "wrote artifacts without the table" \
  || ok "wrote no artifacts without the table"

echo ""
echo "=== Test 4: a refusing renderer fails the sync and leaves no partial file ==="
new_sandbox 1 t
cat > "${SB}/bin/bun" <<'STUB'
#!/usr/bin/env bash
printf 'service-wiring-cli: unsafe hostname\n' >&2
exit 2
STUB
chmod +x "${SB}/bin/bun"
run_sync
rc=$?
[[ ${rc} -ne 0 ]] && ok "sync fails when the renderer refuses" || no "sync succeeded despite a refusing renderer"
[[ -e "${SB}/config/generated/contest-routes.conf" ]] && no "left a partial route file" \
  || ok "removed the partial route file"
grep -q 'refused the registry' "${SB}/sync.log" && ok "reports why it refused" || no "silent refusal"

echo ""
printf 'service-wiring-render: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
