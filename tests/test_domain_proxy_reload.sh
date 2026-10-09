#!/usr/bin/env bash
# A recreated upstream must not leave grader-nginx-proxy serving the old address.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/__domain_proxy_reload.sh"
DOCKER_RS="${REPO_ROOT}/tools/cms-tui/src/core/docker.rs"
MAKEFILE="${REPO_ROOT}/Makefile"

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

# `make -n` rather than grepping the Makefile: a grep would still pass on a
# commented-out line, and it would not follow the DOMAIN_PROXY_RELOAD variable
# to the command it expands to. The dry run asks make itself what it would
# execute, so a line make would never run cannot satisfy this.
if ! command -v make >/dev/null 2>&1; then
  no "make is available to resolve the deploy targets"
else
  ok "make is available to resolve the deploy targets"

  for stack in admin contest; do
    if make -n -C "$REPO_ROOT" "$stack" 2>/dev/null \
      | grep -q '__domain_proxy_reload\.sh'; then
      ok "make ${stack} reloads the domain proxy"
    else
      no "make ${stack} reloads the domain proxy"
    fi
  done

  # Teardown removes containers instead of recreating them, so a reload there
  # would fire against a proxy that is on its way down.
  teardown_ok=1
  for target in admin-stop admin-clean contest-stop contest-clean core-stop; do
    if make -n -C "$REPO_ROOT" "$target" 2>/dev/null \
      | grep -q '__domain_proxy_reload\.sh'; then
      teardown_ok=0
      echo "        unexpected reload in make ${target}"
    fi
  done
  if [[ "$teardown_ok" -eq 1 ]]; then
    ok "make teardown targets leave the proxy alone"
  else
    no "make teardown targets leave the proxy alone"
  fi
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
