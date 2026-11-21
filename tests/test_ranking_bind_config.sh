#!/usr/bin/env bash
# RANKING_BIND_ADDRESS must be a config key that reaches the container, not a
# hardcoded compose default, so a deployment can move the bind.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }

grep -qE '^RANKING_BIND_ADDRESS[[:space:]]*=' "${ROOT}/config.toml.example" \
  || fail "config.toml.example must declare RANKING_BIND_ADDRESS"
grep -q 'RANKING_BIND_ADDRESS: ${RANKING_BIND_ADDRESS' "${ROOT}/docker-compose.yml" \
  || fail "compose must take RANKING_BIND_ADDRESS from the env, not hardcode it"

printf '[PASS] RANKING_BIND_ADDRESS is a config key\n'
