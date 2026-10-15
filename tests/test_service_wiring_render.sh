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

PAYLOAD='{"services":[{"id":1,"name":"cms-contest-web-server-1","role":"ContestWebServer","shard":0,"host":"web-1","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":7,"enabled":true}],"wirings":[],"exposures":[{"service_id":1,"hostname":"routes.example.com","path":"/","tls":true,"tailnet":"cms-7"}]}'

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
  # The sync sources the route table for the front's own vhosts, so the sandbox needs the
  # table and the SSE definition that table sources in turn.
  cp "${REPO_ROOT}/scripts/__domain_routes.sh" "${REPO_ROOT}/scripts/__nginx_sse.sh" "${SB}/scripts/"
  # The renderer is dependency-free, so the real modules run without node_modules.
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring.ts" "${SB}/admin-panel/src/lib/"
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring-render.ts" "${SB}/admin-panel/src/lib/"
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring-cli.ts" "${SB}/admin-panel/src/lib/"
  cp "${REPO_ROOT}/admin-panel/src/lib/service-wiring-front-vhosts.ts" "${SB}/admin-panel/src/lib/"
  printf '%s' "${4:-$PAYLOAD}" > "${SB}/payload.json"
  # The registry rows the compose renderer reads, one row per line. Kept in a file rather
  # than spliced through sed because a row is pipe-separated and sed's delimiter here is |.
  printf '%s\n' "${5:-}" > "${SB}/registry_rows.txt"
  # Test 6 passes an empty third argument to make the registry name no contest.
  local registry_primary="5"
  [[ "$#" -ge 3 ]] && registry_primary="$3"

  cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "ps" ]]; then printf '%s\n' "cms-database"; exit 0; fi
if [[ "${1:-}" == "exec" ]]; then
  sql=""; prev=""
  for a in "$@"; do [[ "$prev" == "-c" ]] && sql="$a"; prev="$a"; done
  printf '%s\n' "$sql" >> "@SQL_LOG@"
  case "$sql" in
    *to_regclass*services*) printf '%s\n' "@SERVICES_TABLE@" ;;
    *"count(*) FROM contest_exposures WHERE tls"*) printf '%s\n' "@TLS_EXPOSED@" ;;
    *"DISTINCT hostname FROM contest_exposures"*) printf '%s\n' "@TLS_HOST@" ;;
    *"DISTINCT tailnet FROM contest_exposures"*) printf '%s\n' "@TAILNET_NODE@" ;;
    *"COALESCE(contest_id::text, 'ALL')"*) printf '%s\n' "@EVAL_BINDING@" ;;
    *"role = 'ContestWebServer'"*) printf '%s\n' "@REGISTRY_PRIMARY@" ;;
    *"count(*) FROM contest_exposures"*) printf '%s\n' "@EXPOSED@" ;;
    *"role IN"*) cat "@REGISTRY_ROWS_FILE@" ;;
    *json_build_object*) cat "@PAYLOAD_FILE@" ;;
    *"DISTINCT db_profile"*) printf '%s\n' "default" ;;
    *information_schema*) printf '%s\n' "@SCHEMA_CURRENT@" ;;
    *to_regclass*) printf '%s\n' "t" ;;
    *"WHERE is_active"*) printf '%s\n' "7" ;;
    *) printf '\n' ;;
  esac
  exit 0
fi
exit 0
STUB
  sed -i -e "s|@SERVICES_TABLE@|${2:-t}|" -e "s|@EXPOSED@|${1:-1}|" \
    -e "s|@TLS_EXPOSED@|${1:-1}|" -e "s|@TLS_HOST@|a.example.com|" -e "s|@TAILNET_NODE@|cms-7|" -e "s|@EVAL_BINDING@|ALL|" -e "s|@REGISTRY_PRIMARY@|$registry_primary|" -e "s|@SQL_LOG@|${SB}/sql.log|" \
    -e "s|@SCHEMA_CURRENT@|${STUB_SCHEMA_CURRENT:-1}|" \
    -e "s|@PAYLOAD_FILE@|${SB}/payload.json|" -e "s|@REGISTRY_ROWS_FILE@|${SB}/registry_rows.txt|" "${SB}/bin/docker"
  chmod +x "${SB}/bin/docker"
}

run_sync() {
  : > "${SB}/sql.log"
  CMS_DOCKER_ROOT="${SB}" PATH="${SB}/bin:${PATH}" bash "${SYNC}" > "${SB}/sync.log" 2>&1
}

echo "=== Test 1: rows present renders the generated route artifacts ==="
new_sandbox 1 t
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
grep -q 'server_name routes.example.com;' "${SB}/config/generated/contest-routes.conf" 2>/dev/null \
  && ok "renders the contest server block" || no "missing contest server block"
grep -q '^primary|a.example.com|/ /admin /ranking /login /ws$' "${SB}/config/generated/front-vhosts.txt" 2>/dev/null \
  && ok "publishes the front's own vhosts with the label that names the fragment and the paths it serves" || no "missing the front vhost map"
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
grep -q '^EVALUATION_CONTEST_ARG=' "${SB}/.env" 2>/dev/null \
  && no "the sync still publishes EVALUATION_CONTEST_ARG" \
  || ok "the sync leaves the launcher to ask the database"
grep -q 'UPDATE contests' "${SB}/sql.log" 2>/dev/null \
  && no "the sync still writes contests.is_active" \
  || ok "the sync issues no UPDATE contests"
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
echo "=== Test 6: the sync never rewrites contests.is_active or CONTEST_ID ==="
new_sandbox 1 t ""
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}"
grep -q 'UPDATE contests' "${SB}/sql.log" 2>/dev/null \
  && no "the sync still writes contests.is_active" \
  || ok "the sync leaves contests.is_active alone"
grep -qE '^CONTEST_ID = (5|7)' "${SB}/config.toml" 2>/dev/null \
  && no "the sync rewrote [contest] CONTEST_ID" \
  || ok "the sync leaves config.toml CONTEST_ID to the operator"

echo ""
echo "=== Test 5: a TLS exposure with no certificate lineage fails the sync ==="
new_sandbox 1 t
sed -i 's|^DOMAIN_NAME = "a.example.com"|DOMAIN_NAME = ""|' "${SB}/config.toml"
run_sync
rc=$?
[[ ${rc} -ne 0 ]] && ok "sync refuses to render an unpointable certificate" || no "rendered a TLS route with no lineage"
grep -q 'no certificate lineage' "${SB}/sync.log" && ok "says which key to set" || no "silent refusal"

echo ""
echo "=== Test 7: a path-only exposure joins its contest's vhost ==="
PATH_PAYLOAD='{"services":[{"id":2,"name":"web-3","role":"ContestWebServer","shard":0,"host":"web-3","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":3,"enabled":true}],"wirings":[],"exposures":[{"service_id":2,"hostname":"cms3.example.com","path":"/","tls":true,"tailnet":null},{"service_id":2,"hostname":"","path":"/beta","tls":true,"tailnet":null}]}'
new_sandbox 2 t 5 "$PATH_PAYLOAD"
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
routes="${SB}/config/generated/contest-routes.conf"
[[ "$(grep -c 'server {' "$routes" 2>/dev/null)" -eq 1 ]] \
  && ok "keeps one server block for the contest" || no "did not keep one server block"
grep -q 'server_name cms3.example.com;' "$routes" 2>/dev/null \
  && ok "answers the contest's vhost" || no "missing the contest vhost"
grep -q 'location ^~ /beta/ {' "$routes" 2>/dev/null \
  && ok "adds the path-only location" || no "missing the path-only location"
grep -q 'proxy_pass http://web-3:8888/;' "$routes" 2>/dev/null \
  && ok "proxies the path-only location to the contest" || no "wrong or missing path-only upstream"

echo ""
echo "=== Test 8: a path-only exposure with no vhost fails the sync ==="
NO_VHOST_PAYLOAD='{"services":[{"id":2,"name":"web-3","role":"ContestWebServer","shard":0,"host":"web-3","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":3,"enabled":true}],"wirings":[],"exposures":[{"service_id":2,"hostname":"","path":"/beta","tls":true,"tailnet":null}]}'
new_sandbox 1 t 5 "$NO_VHOST_PAYLOAD"
run_sync
rc=$?
[[ ${rc} -ne 0 ]] && ok "sync fails when a path-only exposure has no vhost" || no "sync succeeded without a vhost"
grep -q 'refused the registry' "${SB}/sync.log" && ok "reports the refusal" || no "silent refusal"
[[ -e "${SB}/config/generated/contest-routes.conf" ]] && no "left a partial route file" \
  || ok "removed the partial route file"

echo ""
echo "=== Test 9: resolve_bun locates a bun off PATH ==="
new_sandbox 0 t
mkdir -p "${SB}/home/.bun/bin" "${SB}/pb" "${SB}/empty"
printf '#!/bin/sh\nexit 0\n' > "${SB}/home/.bun/bin/bun"
printf '#!/bin/sh\nexit 0\n' > "${SB}/pb/bun"
chmod +x "${SB}/home/.bun/bin/bun" "${SB}/pb/bun"
LIB="${SB}/scripts/__lib/common.sh"
BASH_BIN="$(command -v bash)"
resolved="$(HOME="${SB}/home" PATH="${SB}/empty" BUN_INSTALL="" "$BASH_BIN" -c 'source "$0"; resolve_bun' "$LIB")"
[[ "${resolved}" == "${SB}/home/.bun/bin/bun" ]] \
  && ok "falls back to ~/.bun/bin when PATH has no bun" || no "resolved '${resolved}' instead"
resolved="$(HOME="${SB}/home" PATH="${SB}/pb" BUN_INSTALL="" "$BASH_BIN" -c 'source "$0"; resolve_bun' "$LIB")"
[[ "${resolved}" == "${SB}/pb/bun" ]] && ok "prefers the bun on PATH" || no "resolved '${resolved}' instead"

echo ""
echo "=== Test 10: the generated registry compose binds each row's own port ==="
new_sandbox 1 t 5 "" 'web-3|ContestWebServer|0|web-3|8894|21000|default|ghcr.io/champyod/cms-docker-core:test-tag|always'
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
compose="${SB}/docker-compose.registry.generated.yml"
grep -q 'SERVICE_HTTP_PORT: 8894' "$compose" 2>/dev/null \
  && ok "binds the row's http port" || no "missing SERVICE_HTTP_PORT"
grep -q 'SERVICE_RPC_PORT: 21000' "$compose" 2>/dev/null \
  && ok "binds the row's rpc port" || no "missing SERVICE_RPC_PORT"
grep -q '8894:8894' "$compose" 2>/dev/null \
  && ok "publishes the same port it binds" || no "the publish map does not match the bind port"
grep -q 'image: ghcr.io/champyod/cms-docker-core:test-tag' "$compose" 2>/dev/null \
  && ok "runs the row's own image" || no "did not use the row's image"
grep -q 'pull_policy: always' "$compose" 2>/dev/null \
  && ok "carries the row's pull policy" || no "missing the row's pull policy"
grep -qE 'cmsContestWebServer [0-9]|cmsEvaluationService [0-9]' "$compose" 2>/dev/null \
  && ok "generates a container per registry row" || no "missing the generated registry compose"
grep -qE 'cmsContestWebServer [0-9]+ -c|cmsEvaluationService [0-9]+ -c' "$compose" 2>/dev/null \
  && no "the generated command still binds a contest the process has to read from the database" \
  || ok "leaves the contest to the process, so a re-pointed row reaches a running container"

echo ""
echo "=== Test 11: a row with no image keeps the deployment's IMG_TAG ==="
new_sandbox 1 t 5 "" 'web-3|ContestWebServer|0|web-3|8894|21000|default||missing'
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
grep -q 'image: ghcr.io/champyod/cms-docker-core:${IMG_TAG:-major-admin-panel}' "${SB}/docker-compose.registry.generated.yml" 2>/dev/null \
  && ok "leaves the IMG_TAG for compose to resolve" || no "did not fall back to IMG_TAG"
grep -q 'pull_policy: missing' "${SB}/docker-compose.registry.generated.yml" 2>/dev/null \
  && ok "carries the row's pull policy" || no "missing the row's pull policy"

echo ""
echo "=== Test 12: a row the base compose already owns is left to it ==="
new_sandbox 1 t 5 "" 'cms-contest-web-server|ContestWebServer|0|web-1|8888|21000|default||missing'
printf '%s\n' 'services:' '  contest-web-server:' '    container_name: cms-contest-web-server' > "${SB}/docker-compose.yml"
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
[[ -e "${SB}/docker-compose.registry.generated.yml" ]] \
  && no "generated a service the base compose owns" \
  || ok "leaves the declared container to the base compose"

echo ""
echo "=== Test 13: an unmigrated schema is skipped, not fatal ==="
STUB_SCHEMA_CURRENT=0
new_sandbox 1 t
run_sync
rc=$?
STUB_SCHEMA_CURRENT=1
[[ ${rc} -eq 0 ]] && ok "sync exits 0 before the migration" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
grep -q '20261014140000' "${SB}/sync.log" && ok "names the migration it waits on" || no "the skip does not name the migration"
[[ -e "${SB}/config/generated" ]] && no "rendered artifacts from a schema it cannot read" || ok "renders no artifact"
[[ -f "${SB}/.env" ]] && ok "still writes .env, so the update can migrate" || no "did not write .env"

echo ""
echo "=== Test 14: an exposure on the front's own hostname lands in that vhost's fragment ==="
FRAGMENT_PAYLOAD='{"services":[{"id":4,"name":"web-9","role":"ContestWebServer","shard":0,"host":"web-9","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":9,"enabled":true}],"wirings":[],"exposures":[{"service_id":4,"hostname":"a.example.com","path":"/beta","tls":true,"tailnet":null}]}'
new_sandbox 1 t 5 "$FRAGMENT_PAYLOAD"
printf '%s\n' 'server {' '    server_name a.example.com;' '}' > "${SB}/config/grader.nginx.conf"
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
fragment="${SB}/config/generated/locations-primary.conf"
grep -q 'location ^~ /beta/ {' "$fragment" 2>/dev/null \
  && ok "renders the exposure into the primary vhost's fragment" || no "missing the fragment location"
grep -q 'set \$cms_primary web-9:8888;' "$fragment" 2>/dev/null \
  && ok "dials the registered upstream through the vhost's own variable" || no "wrong or missing fragment upstream target"
grep -q 'rewrite ^/beta/(.*)\$ /\$1 break;' "$fragment" 2>/dev/null \
  && ok "strips the prefix the variable target cannot" || no "missing the fragment rewrite"
grep -q 'proxy_pass http://\$cms_primary;' "$fragment" 2>/dev/null \
  && ok "proxies to the variable, so the shared resolver answers it per request" || no "missing the variable proxy_pass"
grep -qE 'listen |server_name |ssl_certificate ' "$fragment" 2>/dev/null \
  && no "the fragment carries listener lines the vhost already declares" \
  || ok "the fragment carries locations only"
grep -q 'server_name a.example.com;' "${SB}/config/generated/contest-routes.conf" 2>/dev/null \
  && no "opened a second server block for a hostname the front already serves" \
  || ok "leaves the vhost's own block to the front"

echo ""
echo "=== Test 15: a generated row is probed the way its role's declared service is ==="
new_sandbox 1 t 5 "" 'eval-b|EvaluationService|1|eval-b|25001|21001|default||missing'
cat > "${SB}/docker-compose.yml" <<'YAML'
services:
  evaluation-service:
    container_name: cms-evaluation-service
    environment:
      SERVICE_TYPE: EvaluationService
    healthcheck:
      test: ["CMD-SHELL", "pgrep -f cmsEvaluationService || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s
YAML
run_sync
rc=$?
compose="${SB}/docker-compose.registry.generated.yml"
[[ ${rc} -eq 0 ]] && ok "sync exits 0" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
grep -q 'healthcheck:' "$compose" 2>/dev/null && ok "the row carries a healthcheck" || no "the row has no healthcheck"
grep -q '21001' "$compose" 2>/dev/null && ok "probes the port the row itself binds" || no "does not probe the row's own port"
grep -q 'start_period: 60s' "$compose" 2>/dev/null && ok "takes the timings from the declared service" || no "missing the declared timings"

echo ""
echo "=== Test 16: a path the front's own vhost already serves fails the sync ==="
# WHY the operator's key decides which paths those are: the published paths are the route table's
# own `*_ROUTE_PATH` keys, so renaming one has to move the refusal with it rather than leave the
# guard on a list of its own — which would refuse a path nobody curates and admit a fragment that
# shadows the one the key still names.
CURATED_PAYLOAD='{"services":[{"id":4,"name":"web-9","role":"ContestWebServer","shard":0,"host":"web-9","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":9,"enabled":true}],"wirings":[],"exposures":[{"service_id":4,"hostname":"a.example.com","path":"/ranking","tls":true,"tailnet":null}]}'
new_sandbox 1 t 5 "$CURATED_PAYLOAD"
printf '%s\n' 'server {' '    server_name a.example.com;' '}' > "${SB}/config/grader.nginx.conf"
run_sync
rc=$?
[[ ${rc} -ne 0 ]] && ok "sync refuses a path the vhost's own locations already serve" || no "sync accepted a curated path"
grep -q 'refused the registry' "${SB}/sync.log" && ok "reports why it refused" || no "silent refusal"
[[ -e "${SB}/config/generated/locations-primary.conf" ]] \
  && no "left a fragment behind" || ok "leaves no fragment behind"

RENAMED_PAYLOAD='{"services":[{"id":4,"name":"web-9","role":"ContestWebServer","shard":0,"host":"web-9","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":9,"enabled":true}],"wirings":[],"exposures":[{"service_id":4,"hostname":"a.example.com","path":"/board","tls":true,"tailnet":null}]}'
new_sandbox 1 t 5 "$RENAMED_PAYLOAD"
sed -i 's|^RANKING_ROUTE_PATH = .*|RANKING_ROUTE_PATH = "/board"|' "${SB}/config.toml"
printf '%s\n' 'server {' '    server_name a.example.com;' '}' > "${SB}/config/grader.nginx.conf"
run_sync
rc=$?
[[ ${rc} -ne 0 ]] && ok "refuses the path the renamed key now claims" || no "the guard did not follow RANKING_ROUTE_PATH"
grep -q '^primary|a.example.com|/ /admin /board /login /ws$' "${SB}/config/generated/front-vhosts.txt" 2>/dev/null \
  && ok "publishes the paths the vhost's own block serves" || no "the map does not carry the vhost's paths"

FREED_PAYLOAD='{"services":[{"id":4,"name":"web-9","role":"ContestWebServer","shard":0,"host":"web-9","http_port":8888,"rpc_port":21000,"db_profile":"default","contest_id":9,"enabled":true}],"wirings":[],"exposures":[{"service_id":4,"hostname":"a.example.com","path":"/ranking","tls":true,"tailnet":null}]}'
new_sandbox 1 t 5 "$FREED_PAYLOAD"
sed -i 's|^RANKING_ROUTE_PATH = .*|RANKING_ROUTE_PATH = "/board"|' "${SB}/config.toml"
printf '%s\n' 'server {' '    server_name a.example.com;' '}' > "${SB}/config/grader.nginx.conf"
run_sync
rc=$?
[[ ${rc} -eq 0 ]] && ok "accepts a path no key claims any more" || no "sync exit ${rc}: $(tail -2 "${SB}/sync.log" | tr '\n' ' ')"
grep -q 'location ^~ /ranking/ {' "${SB}/config/generated/locations-primary.conf" 2>/dev/null \
  && ok "renders the freed path into the vhost's fragment" || no "missing the freed path's fragment location"

echo ""
printf 'service-wiring-render: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
