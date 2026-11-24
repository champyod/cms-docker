#!/usr/bin/env bash
# tests/test_scoring_compose.sh — the scoring container runs the Rust daemon with its RPC and database inputs.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cms-scoring-compose-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PASS=0
FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "FAIL: docker compose is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required" >&2
  exit 1
fi

SECRET="0123456789abcdef0123456789abcdef"
DATABASE_URL="postgresql://scoring_user:scoring_password@database:5432/scoring_db"

if ! POSTGRES_USER=scoring_user POSTGRES_PASSWORD=scoring_password POSTGRES_DB=scoring_db \
  RPC_SECRET="$SECRET" INNER_IP=127.0.0.1 \
  docker compose --env-file /dev/null --profile core config --format json scoring-service \
  >"$TEST_ROOT/config.json" 2>"$TEST_ROOT/stderr"; then
  cat "$TEST_ROOT/stderr" >&2
  echo "FAIL: scoring compose config exits 0" >&2
  exit 1
fi
pass "scoring compose config exits 0"

if jq -e --arg url "$DATABASE_URL" --arg secret "$SECRET" '
  .services["scoring-service"] as $scoring |
  ($scoring.environment.DATABASE_URL == $url) and
  ($scoring.environment.RPC_SECRET == $secret) and
  ($scoring.environment.SCORING_SERVICE_PORT == "28500") and
  ($scoring.environment.SCORING_SERVICE_SHARD == "0") and
  ($scoring.environment.SERVICE_SHARD == "0")
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "scoring receives DATABASE_URL, RPC_SECRET, port and shard"
else
  fail "scoring environment does not carry the rendered inputs"
fi

if jq -e '
  .services["scoring-service"] as $scoring |
  (($scoring.command | join(" ")) | contains("exec cms-scoring")) and
  (($scoring.command | join(" ")) | contains("cmsScoringService") | not)
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "scoring command execs cms-scoring instead of cmsScoringService"
else
  fail "scoring command does not exec cms-scoring"
fi

if jq -e '
  .services["scoring-service"] as $scoring |
  (($scoring.healthcheck.test | join(" ")) | contains("pgrep -x cms-scoring")) and
  (($scoring.healthcheck.test | join(" ")) | contains("python3") | not)
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "scoring healthcheck uses the exact Rust process name"
else
  fail "scoring healthcheck does not use pgrep -x cms-scoring"
fi

if jq -e '
  .services["scoring-service"] as $scoring |
  ($scoring.profiles == ["core"]) and
  ($scoring.ports | length == 1) and
  ($scoring.ports[0].host_ip == "127.0.0.1") and
  ($scoring.ports[0].published == "28500") and
  ($scoring.ports[0].target == 28500) and
  (($scoring.volumes | map(.target)) == [
    "/usr/local/etc/cms.toml",
    "/var/local/log/cms",
    "/var/local/cache/cms",
    "/var/local/lib/cms"
  ])
' "$TEST_ROOT/config.json" >/dev/null; then
  pass "scoring keeps the core profile, port mapping and volume shape"
else
  fail "scoring profile, port mapping or volume shape changed"
fi

if POSTGRES_USER=scoring_user POSTGRES_PASSWORD=scoring_password POSTGRES_DB=scoring_db \
  RPC_SECRET="$SECRET" INNER_IP=127.0.0.1 \
  SCORING_SERVICE_PORT=28501 SCORING_SERVICE_SHARD=2 \
  docker compose --env-file /dev/null --profile core config --format json scoring-service \
  >"$TEST_ROOT/override.json" 2>"$TEST_ROOT/override.stderr"; then
  if jq -e '
    .services["scoring-service"] as $scoring |
    ($scoring.environment.SCORING_SERVICE_PORT == "28501") and
    ($scoring.environment.SCORING_SERVICE_SHARD == "2") and
    ($scoring.environment.SERVICE_SHARD == "2") and
    ($scoring.ports[0].published == "28500") and
    ($scoring.ports[0].target == 28501) and
    (($scoring.command | join(" ")) | contains("ScoringService-2"))
  ' "$TEST_ROOT/override.json" >/dev/null; then
    pass "scoring port and shard overrides reach the process and port target"
  else
    fail "scoring overrides do not reach the process or port target"
  fi
else
  cat "$TEST_ROOT/override.stderr" >&2
  fail "scoring compose config with overrides exits 0"
fi

if grep -Fq -- '--package cms-scoring --bin cms-scoring' "$REPO_ROOT/Dockerfile"; then
  pass "Dockerfile builds cms-scoring"
else
  fail "Dockerfile does not build cms-scoring"
fi

if grep -Fq -- '/build/target/release/cms-scoring /home/cmsuser/cms/bin/cms-scoring' "$REPO_ROOT/Dockerfile"; then
  pass "Dockerfile installs cms-scoring beside the other service binaries"
else
  fail "Dockerfile does not install cms-scoring"
fi

if grep -Fq -- 'SCORING_SERVICE_PORT = 28500' "$REPO_ROOT/config.toml.example" &&
  grep -Fq -- '"Core & Network|[core]|SCORING_SERVICE_PORT|port||28500"' "$REPO_ROOT/scripts/__update_engine.sh"; then
  pass "scoring port is configurable from config.toml"
else
  fail "scoring port is missing from config.toml or VAR_SPECS"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
