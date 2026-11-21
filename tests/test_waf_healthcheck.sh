#!/usr/bin/env bash
# A healthcheck probe that cannot pass pins the WAF container to unhealthy forever,
# failing every service_healthy gate and reporting red status.
#
# Docker is unavailable in the test environment and the owasp/modsecurity-crs image
# cannot be pulled, so these assert the contract of the compose probe statically.
# PyYAML is not installed on the developer host (`python3 -c "import yaml"` fails)
# and installing it is out of scope, so the healthcheck test line is extracted with
# awk rather than a YAML parser.
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="${REPO_ROOT}/docker-compose.waf.yml"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

probe_line="$(awk '/^[[:space:]]*healthcheck:[[:space:]]*$/ { in_hc = 1; next }
                     in_hc && /^[[:space:]]*test:[[:space:]]/ { print; exit }' "$COMPOSE")"

if [[ -n "$probe_line" ]]; then
  ok "the healthcheck block declares a test probe"
else
  no "the healthcheck block declares a test probe"
  printf '\n%d passed, %d failed\n' "$pass" "$fail"
  [[ "$fail" -eq 0 ]]
  exit $?
fi

echo "the probe reads the body instead of only checking the URL exists"
# busybox wget --spider skips the transfer; -O is what makes it retrieve the body,
# which is what proves nginx can actually serve the endpoint end to end.
if [[ "$probe_line" == *"--spider"* ]]; then
  no "the probe does not use --spider"
else
  ok "the probe does not use --spider"
fi

if [[ "$probe_line" == *"-O /dev/null"* || "$probe_line" == *"-O/dev/null"* ]]; then
  ok "the probe retrieves the body into /dev/null"
else
  no "the probe retrieves the body into /dev/null"
fi

echo "the probe reaches the listener on the address it is bound to"
# The container's nginx binds IPv4 only, so a name that prefers ::1 never connects.
if [[ "$probe_line" == *"localhost"* ]]; then
  no "the probe does not depend on the resolver order of localhost"
else
  ok "the probe does not depend on the resolver order of localhost"
fi

if [[ "$probe_line" == *"127.0.0.1"* ]]; then
  ok "the probe pins the loopback address to 127.0.0.1"
else
  no "the probe pins the loopback address to 127.0.0.1"
fi

if [[ "$probe_line" == *"127.0.0.1:8080/healthz"* ]]; then
  ok "the probe targets /healthz on the port nginx listens on"
else
  no "the probe targets /healthz on the port nginx listens on"
fi

echo "a failing probe is reported as unhealthy"
if [[ "$probe_line" =~ \|\|[[:space:]]*exit[[:space:]]+[1-9] ]]; then
  ok "the probe exits non-zero when the request fails"
else
  no "the probe exits non-zero when the request fails"
fi

echo "the probe reports the WAF, not a dependency"
# / is reverse-proxied to the backend, so a fallback probe there would redden the
# WAF whenever an upstream is down, which is a different failure than the one
# this probe exists to detect.
probe_count="$(grep -o 'wget' <<<"$probe_line" | wc -l | tr -d ' ')"
if [[ "$probe_count" -eq 1 ]]; then
  ok "the probe issues a single request with no fallback branch"
else
  no "the probe issues a single request with no fallback branch"
  printf '%s\n' "$probe_line"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]