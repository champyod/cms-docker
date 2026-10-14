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
  # A domain is what a TLS exposure points its certificate at, so the sandbox carries one;
  # without it the sync refuses to render a TLS route, which is the behaviour Test 5 pins.
  sed -e 's|^DOMAIN_NAME = ""|DOMAIN_NAME = "a.example.com"|' \
    "${SB}/config.toml.example" > "${SB}/config.toml"
  cp "${REPO_ROOT}/config/cms.sample.toml" "${SB}/config/" 2>/dev/null || true
  cp "${SYNC}" "${SB}/scripts/"
  cp -r "${REPO_ROOT}/scripts/__lib/." "${SB}/scripts/__lib/"
  # The renderer is dependency-free, so the real modules run without node_modules.
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring.ts" "${SB}/admin-panel/src/lib/"
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring-render.ts" "${SB}/admin-panel/src/lib/"
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring-cli.ts" "${SB}/admin-panel/src/lib/"
  printf '%s' "${PAYLOAD}" > "${SB}/payload.json"
  # Test 6 passes an empty third argument to make the registry name no contest.
  local registry_primary="5"
  [[ "$#" -ge 3 ]] && registry_primary="$3"

  cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "ps" ]]; then printf '%s\n' "cms-database"; exit 0; fi
if [[ "${1:-}" == "exec" ]]; then
  sql=""; prev=""
  for a in "$@"; do [[ "$prev" == "-c" ]] && sql="$a"; prev="$a"; done
  case "$sql" in
    *to_regclass*services*) printf '%s\n' "@SERVICES_TABLE@" ;;
    *"count(*) FROM contest_exposures WHERE tls"*) printf '%s\n' "@TLS_EXPOSED@" ;;
    *"DISTINCT hostname FROM contest_exposures"*) printf '%s\n' "@TLS_HOST@" ;;
    *"DISTINCT tailnet FROM contest_exposures"*) printf '%s\n' "@TAILNET_NODE@" ;;
    *"COALESCE(contest_id::text, 'ALL')"*) printf '%s\n' "@EVAL_BINDING@" ;;
    *"role = 'ContestWebServer'"*) printf '%s\n' "@REGISTRY_PRIMARY@" ;;
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
    -e "s|@TLS_EXPOSED@|${1:-1}|" -e "s|@TLS_HOST@|a.example.com|" -e "s|@TAILNET_NODE@|cms-7|" -e "s|@EVAL_BINDING@|ALL|" -e "s|@REGISTRY_PRIMARY@|$registry_primary|" \
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
grep -q 'AllowFunnel' "${SB}/config/generated/tailscale/cms-7.json" 2>/dev/null \
  && ok "renders one serve config per tailnet node" || no "missing the per-node serve config"
grep -q 'ssl_certificate /etc/letsencrypt/live/' "${SB}/config/generated/contest-routes.conf" 2>/dev/null \
  && ok "points TLS at the domain proxy lineage" || no "TLS does not use the domain cert path"
grep -q 'include /etc/nginx/conf.d/nginx-ssl.conf;' "${SB}/config/generated/contest-routes.conf" 2>/dev/null \
  && ok "carries the shared ssl parameters" || no "missing the shared ssl include"
grep -q '^a.example.com$' "${SB}/config/generated/exposed-hosts.txt" 2>/dev/null \
  && ok "publishes the TLS hostnames for the certificate" || no "missing the exposed host list"
grep -q 'cms-tailscale-cms-7:' "${SB}/docker-compose.tailscale.generated.yml" 2>/dev/null \
  && ok "generates one tailscale container per node" || no "missing the generated tailscale compose"
grep -q 'tailscale/cms-7.json:/config/serve.json' "${SB}/docker-compose.tailscale.generated.yml" 2>/dev/null \
  && ok "mounts that node's own serve config" || no "the container does not mount its node config"
grep -q 'TS_AUTHKEY=${TAILSCALE_AUTHKEY}' "${SB}/docker-compose.tailscale.generated.yml" 2>/dev/null \
  && ok "references the authkey instead of copying it" || no "the authkey is not referenced by name"
grep -q '^EVALUATION_CONTEST_ARG=.*-c ALL' "${SB}/.env" 2>/dev/null \
  && ok "publishes the multi-contest launcher argument" || no "missing EVALUATION_CONTEST_ARG"
grep -q '^CONTEST_ID = 5' "${SB}/config.toml" 2>/dev/null \
  && ok "takes CONTEST_ID from the registry, not from is_active" || no "CONTEST_ID did not follow the registry"
grep -q 'derived from the service registry' "${SB}/sync.log" 2>/dev/null \
  && ok "reports which authority answered" || no "did not report the registry as the source"
if command -v docker >/dev/null 2>&1; then
  TAILSCALE_AUTHKEY=x docker compose -f "${SB}/docker-compose.tailscale.generated.yml" config --quiet 2>/dev/null \
    && ok "the generated compose file validates" || no "the generated compose file is invalid"
fi

echo ""
echo "=== Test 2: nothing exposed leaves the N=1 path untouched ==="
new_sandbox 0 t
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0 with no exposures" || no "sync exit ${rc}"
[[ -e "${SB}/config/generated" ]] && no "wrote artifacts with nothing exposed" \
  || ok "wrote no artifacts with nothing exposed"
[[ -e "${SB}/docker-compose.tailscale.generated.yml" ]] && no "left a generated tailscale compose behind" \
  || ok "removes the generated tailscale compose"

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
echo "=== Test 6: an empty registry falls back to contests.is_active ==="
new_sandbox 1 t ""
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}"
grep -q '^CONTEST_ID = 7' "${SB}/config.toml" 2>/dev/null \
  && ok "falls back to is_active when the registry names no contest" || no "the fallback lost is_active"
grep -q 'derived from contests.is_active' "${SB}/sync.log" 2>/dev/null \
  && ok "says the singleton answered" || no "did not attribute the fallback"

echo ""
echo "=== Test 5: a TLS exposure with no certificate lineage fails the sync ==="
new_sandbox 1 t
sed -i 's|^DOMAIN_NAME = "a.example.com"|DOMAIN_NAME = ""|' "${SB}/config.toml"
run_sync
rc=$?
[[ ${rc} -ne 0 ]] && ok "sync refuses to render an unpointable certificate" || no "rendered a TLS route with no lineage"
grep -q 'no certificate lineage' "${SB}/sync.log" && ok "says which key to set" || no "silent refusal"

echo ""
printf 'service-wiring-render: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
