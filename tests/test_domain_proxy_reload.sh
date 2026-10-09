#!/usr/bin/env bash
# A recreated upstream must not leave grader-nginx-proxy serving the old address.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/__domain_proxy_reload.sh"
DOCKER_RS="${REPO_ROOT}/tools/cms-tui/src/core/docker.rs"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
DOCKER_LOG="${SANDBOX}/docker.log"
export DOCKER_LOG
mkdir -p "${SANDBOX}/bin"
cat > "${SANDBOX}/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "${1:-}" in
  ps) [[ -n "${PROXY_RUNNING:-}" ]] && printf '%s\n' 'grader-nginx-proxy' ;;
  exec) printf '%s\n' "$*" >> "${DOCKER_LOG}"; [[ -n "${EXEC_FAILS:-}" ]] && exit 1 ;;
esac
exit 0
STUB
chmod +x "${SANDBOX}/bin/docker"
export PATH="${SANDBOX}/bin:${PATH}"

echo "a deploy without the domain stack is not a failure"
if PROXY_RUNNING="" bash "$SCRIPT" >/dev/null 2>&1; then
  ok "exits 0 when grader-nginx-proxy is not running"
else
  no "exits 0 when grader-nginx-proxy is not running"
fi
if [[ ! -s "$DOCKER_LOG" ]]; then
  ok "no reload attempted without a container"
else
  no "no reload attempted without a container"
fi

echo "a running proxy is reloaded so upstreams are re-resolved"
PROXY_RUNNING=1 bash "$SCRIPT" >/dev/null 2>&1
if grep -q 'exec grader-nginx-proxy nginx -s reload' "$DOCKER_LOG" 2>/dev/null; then
  ok "runs nginx -s reload in grader-nginx-proxy"
else
  no "runs nginx -s reload in grader-nginx-proxy"
fi

echo "a failed reload never fails the deploy that succeeded"
if EXEC_FAILS=1 PROXY_RUNNING=1 \
    bash "$SCRIPT" >/dev/null 2>&1; then
  ok "exits 0 when the reload fails"
else
  no "exits 0 when the reload fails"
fi

echo "deploy actually runs this script"
if grep -q '__domain_proxy_reload.sh' "$DOCKER_RS"; then
  ok "DockerClient::deploy delegates to the script"
else
  no "DockerClient::deploy delegates to the script"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
