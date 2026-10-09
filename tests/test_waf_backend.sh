#!/usr/bin/env bash
# A hardcoded BACKEND points grader-waf at a port the proxy no longer serves.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="${REPO_ROOT}/docker-compose.waf.yml"
EXAMPLE="${REPO_ROOT}/config.toml.example"
SPEC="${REPO_ROOT}/scripts/__update_engine.sh"
DOCS="${REPO_ROOT}/docs/waf-tuning.md"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

echo "the upstream is a config key, never a literal"
backend_lines="$(grep -E '^ +BACKEND(_WS)?:' "$COMPOSE")"
if [[ -n "$backend_lines" ]] \
   && [[ "$(printf '%s\n' "$backend_lines" | grep -c 'WAF_BACKEND')" -eq 2 ]]; then
  ok "both BACKEND and BACKEND_WS read \${WAF_BACKEND:-...}"
else
  no "both BACKEND and BACKEND_WS read \${WAF_BACKEND:-...}"
  printf '%s\n' "$backend_lines"
fi

echo "the default keeps the pre-existing wiring"
if grep -q 'WAF_BACKEND:-http://grader-nginx-proxy:80' "$COMPOSE"; then
  ok "default is http://grader-nginx-proxy:80"
else
  no "default is http://grader-nginx-proxy:80"
fi

echo "the key is settable from config.toml"
if grep -q '^WAF_BACKEND = ' "$EXAMPLE"; then
  ok "config.toml.example defines WAF_BACKEND"
else
  no "config.toml.example defines WAF_BACKEND"
fi

if grep -q '\[infra\]|WAF_BACKEND|' "$SPEC"; then
  ok "VAR_SPECS declares WAF_BACKEND"
else
  no "VAR_SPECS declares WAF_BACKEND"
fi

echo "no documented path points at a redirect-only port"
if grep -q 'continues to terminate TLS' "$DOCS"; then
  no "docs stop claiming nginx terminates TLS for the WAF path"
else
  ok "docs stop claiming nginx terminates TLS for the WAF path"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
