#!/usr/bin/env bash
# tests/test_checker_compose.sh — the checker container runs the Rust binary with its RPC inputs.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cms-checker-compose-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PASS=0
FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "FAIL: docker compose is required" >&2
  exit 1
fi

SERVICES=$'LogService|0|cms-log-service|29000\nChecker|0|cms-checker-service|22000\n'
SECRET="0123456789abcdef0123456789abcdef"

if ! CMS_SERVICES="$SERVICES" RPC_SECRET="$SECRET" INNER_IP=127.0.0.1 \
  docker compose --env-file /dev/null --profile core config --format json checker-service \
  >"$TEST_ROOT/config.json" 2>"$TEST_ROOT/stderr"; then
  cat "$TEST_ROOT/stderr" >&2
  echo "FAIL: checker compose config exits 0" >&2
  exit 1
fi
pass "checker compose config exits 0"

if jq -e --arg services "$SERVICES" --arg secret "$SECRET" '
  .services["checker-service"] as $checker |
  ($checker.environment.CMS_SERVICES == $services) and
  ($checker.environment.RPC_SECRET == $secret) and
  ($checker.environment.CHECKER_SERVICE_PORT == "22000") and
  ($checker.environment.CHECKER_SERVICE_SHARD == "0") and
  ($checker.environment.SERVICE_SHARD == "0") and
  ($checker.environment.SERVICE_TYPE == "Checker")
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "checker receives CMS_SERVICES, RPC_SECRET, port and shard"
else
  fail "checker environment does not carry the rendered inputs"
fi

if jq -e '
  .services["checker-service"] as $checker |
  (($checker.command | join(" ")) | contains("exec cms-checker")) and
  (($checker.command | join(" ")) | contains("cmsChecker") | not)
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "checker command execs cms-checker instead of cmsChecker"
else
  fail "checker command does not exec cms-checker"
fi

if jq -e '
  .services["checker-service"] as $checker |
  (($checker.healthcheck.test | join(" ")) | contains("pgrep -x cms-checker")) and
  (($checker.healthcheck.test | join(" ")) | contains("python3") | not)
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "checker healthcheck uses the exact Rust process name"
else
  fail "checker healthcheck does not use pgrep -x cms-checker"
fi

if jq -e '
  .services["checker-service"] as $checker |
  ($checker.profiles == ["core"]) and
  ($checker.ports | length == 1) and
  ($checker.ports[0].host_ip == "127.0.0.1") and
  ($checker.ports[0].published == "22000") and
  ($checker.ports[0].target == 22000) and
  (($checker.volumes | map(.target)) == [
    "/usr/local/etc/cms.toml",
    "/var/local/log/cms",
    "/var/local/cache/cms",
    "/var/local/lib/cms"
  ])
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "checker keeps the core profile, port mapping and volume shape"
else
  fail "checker profile, port mapping or volume shape changed"
fi

if CMS_SERVICES="$SERVICES" RPC_SECRET="$SECRET" INNER_IP=127.0.0.1 \
  CHECKER_SERVICE_PORT=22001 CHECKER_SERVICE_SHARD=2 \
  docker compose --env-file /dev/null --profile core config --format json checker-service \
  >"$TEST_ROOT/override.json" 2>"$TEST_ROOT/override.stderr"; then
  if jq -e '
    .services["checker-service"] as $checker |
    ($checker.environment.CHECKER_SERVICE_PORT == "22001") and
    ($checker.environment.CHECKER_SERVICE_SHARD == "2") and
    ($checker.environment.SERVICE_SHARD == "2") and
    ($checker.ports[0].published == "22000") and
    ($checker.ports[0].target == 22001) and
    (($checker.command | join(" ")) | contains("Checker-2"))
  ' "$TEST_ROOT/override.json" >/dev/null; then
    pass "checker port and shard overrides reach the process and port target"
  else
    fail "checker overrides do not reach the process, command or port target"
  fi
else
  cat "$TEST_ROOT/override.stderr" >&2
  fail "checker compose config with overrides exits 0"
fi

if grep -Fq -- '--bin cms-checker' "$REPO_ROOT/Dockerfile"; then
  pass "Dockerfile builds cms-checker"
else
  fail "Dockerfile does not build cms-checker"
fi

if grep -Fq -- '/build/target/release/cms-checker /home/cmsuser/cms/bin/cms-checker' "$REPO_ROOT/Dockerfile"; then
  pass "Dockerfile installs cms-checker beside the other service binaries"
else
  fail "Dockerfile does not install cms-checker"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
