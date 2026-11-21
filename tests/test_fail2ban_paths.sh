#!/usr/bin/env bash
# The fail2ban jail must read the nginx logs from the Docker volumes, not a
# /var/log/nginx that does not exist on the host; the setup script resolves the
# placeholder to the volumes' host path.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAIL="${ROOT}/config/fail2ban/jail.d/grader.conf"

fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }

[[ -f "$JAIL" ]] || fail "missing jail: $JAIL"

grep -q '__NGINX_LOG_GLOB__' "$JAIL" \
  || fail "the jail must carry the log-path placeholder"
if grep -qE '^[[:space:]]*logpath[[:space:]]*=[[:space:]]*/var/log/nginx' "$JAIL"; then
  fail "the jail still sets logpath=/var/log/nginx"
fi

out="$(bash "${ROOT}/scripts/__fail2ban-setup.sh" --check 2>&1 || true)"
printf '%s' "$out" | grep -q 'volumes/cms-nginx-logs-' \
  || fail "--check must resolve the nginx volume log glob"

printf '[PASS] fail2ban jail resolves to the nginx Docker volumes\n'
