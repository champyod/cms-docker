#!/usr/bin/env bash
# scripts/__test_config_sync.sh — regression tests for db-profile migration and
# dry-run consistency. Runs in a throwaway directory; never touches the real
# config.toml or .env.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cms-config-sync-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

assert_exit() {
  local want="$1" got="$2" label="$3"
  if [[ "$want" -eq "$got" ]]; then pass "$label"; else fail "$label (want exit $want, got $got)"; fi
}

assert_grep() {
  local file="$1" pattern="$2" label="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then pass "$label"; else fail "$label (pattern '$pattern' not found in $file)"; fi
}

# --- fixtures: old layout (POSTGRES_* in [core], no [db_default]) ---
write_old_layout() {
  cat > "$TEST_ROOT/config.toml" <<'TOML'
[core]
COMPOSE_PROJECT_NAME = "test-project"
ACTIVE_DATABASE = "default"
POSTGRES_HOST = "database"
POSTGRES_PORT = 5432
POSTGRES_PORT_EXTERNAL = 5432
POSTGRES_DB = "testdb"
POSTGRES_USER = "testuser"
POSTGRES_PASSWORD = "realsecret123456"
POSTGRES_BACKUP_PASSWORD = "backupsecret123456"
POSTGRES_HOST_AUTH_METHOD = "md5"
TOML
}

setup_test_root() {
  rm -rf -- "$TEST_ROOT"
  mkdir -p "$TEST_ROOT/config" "$TEST_ROOT/admin-panel"
  cp "$REPO_ROOT/config.toml.example" "$TEST_ROOT/config.toml.example"
  cp "$REPO_ROOT/config/cms.sample.toml" "$TEST_ROOT/config/" 2>/dev/null || true
  cp "$REPO_ROOT/config/cms.ranking.sample.toml" "$TEST_ROOT/config/" 2>/dev/null || true
  write_old_layout
}

run_sync() {
  CMS_DOCKER_ROOT="$TEST_ROOT" bash "$SCRIPT_DIR/__config_sync.sh" "$@" \
    > "$TEST_ROOT/sync-output.log" 2>&1
}

echo "=== Test 1: dry-run on old layout exits 0 ==="
setup_test_root
run_sync --dry-run
assert_exit 0 $? "dry-run on old layout exits 0"
assert_grep "$TEST_ROOT/sync-output.log" "Active database profile" "dry-run reports db_default profile"

echo ""
echo "=== Test 2: real run migrates POSTGRES_* to [db_default] ==="
setup_test_root
run_sync
assert_exit 0 $? "real run exits 0"
assert_grep "$TEST_ROOT/config.toml" '^\[db_default\]' "config.toml now has [db_default]"
assert_grep "$TEST_ROOT/config.toml" 'POSTGRES_PASSWORD = "realsecret123456"' "real password preserved in config.toml"
assert_grep "$TEST_ROOT/config.toml" '^\[core\]' "config.toml [core] section still exists"

echo ""
echo "=== Test 3: .env receives the real password ==="
if [[ -f "$TEST_ROOT/.env" ]]; then
  pass ".env was created"
  assert_grep "$TEST_ROOT/.env" '^POSTGRES_PASSWORD=.*realsecret123456' ".env POSTGRES_PASSWORD is non-empty"
  assert_grep "$TEST_ROOT/.env" '^POSTGRES_BACKUP_PASSWORD=.*backupsecret123456' ".env POSTGRES_BACKUP_PASSWORD is non-empty"
else
  fail ".env was not created"
fi

echo ""
echo "=== Test 4: [core] no longer holds POSTGRES_* after migration ==="
core_block="$(sed -n '/^\[core\]/,/^\[/p' "$TEST_ROOT/config.toml")"
if echo "$core_block" | grep -q 'POSTGRES_PASSWORD'; then
  fail "[core] still has POSTGRES_PASSWORD after migration"
else
  pass "[core] POSTGRES_* removed after migration"
fi

echo ""
echo "=== Test 5: second dry-run is idempotent ==="
run_sync --dry-run
assert_exit 0 $? "second dry-run exits 0"

echo ""
echo "=== Test 6: dry-run does not modify config.toml ==="
setup_test_root
cp "$TEST_ROOT/config.toml" "$TEST_ROOT/config.toml.before"
run_sync --dry-run
if diff -q "$TEST_ROOT/config.toml" "$TEST_ROOT/config.toml.before" >/dev/null 2>&1; then
  pass "dry-run leaves config.toml unchanged"
else
  fail "dry-run modified config.toml"
fi

echo ""
echo "=== Test 7: .env carries the logger's three inputs ==="
setup_test_root
# A cms.toml the injection step has already rendered: [global] log_dir is live.
sed 's|^#log_dir = .*|log_dir = "/var/local/log/cms"|' "$TEST_ROOT/config/cms.sample.toml" \
  > "$TEST_ROOT/config/cms.toml"
run_sync
assert_exit 0 $? "real run with a rendered cms.toml exits 0"
assert_grep "$TEST_ROOT/.env" '^LOG_SERVICE_ADDR=cms-log-service:29000$' \
  ".env LOG_SERVICE_ADDR is the [services] LogService shard"
assert_grep "$TEST_ROOT/.env" '^LOG_DIR=/var/local/log/cms$' ".env LOG_DIR is [global] log_dir"
if grep -Eq '^RPC_SECRET=.{32,}$' "$TEST_ROOT/.env"; then
  pass ".env RPC_SECRET is the generated secret"
else
  fail ".env RPC_SECRET is missing or too short to be the generated secret"
fi

echo ""
echo "=== Test 8: no [global] log_dir leaves LOG_DIR out rather than inventing one ==="
setup_test_root
run_sync
assert_exit 0 $? "real run without a rendered log_dir still exits 0"
assert_grep "$TEST_ROOT/sync-output.log" 'has no \[global\] log_dir' "the omission is reported"
if grep -q '^LOG_DIR=' "$TEST_ROOT/.env"; then
  fail "LOG_DIR emitted although cms.toml has no [global] log_dir"
else
  pass "no LOG_DIR without [global] log_dir"
fi

echo ""
echo "=== Test 9: a missing [services] LogService stops the sync ==="
setup_test_root
grep -v '^LogService = ' "$TEST_ROOT/config/cms.sample.toml" > "$TEST_ROOT/config/cms.toml"
if run_sync; then sync_code=0; else sync_code=$?; fi
assert_exit 1 "$sync_code" "sync exits 1 without [services] LogService"
assert_grep "$TEST_ROOT/sync-output.log" 'has no \[services\] LogService' \
  "the failure names the missing entry"
if grep -q '^LOG_SERVICE_ADDR=' "$TEST_ROOT/.env" 2>/dev/null; then
  fail "LOG_SERVICE_ADDR emitted empty without [services] LogService"
else
  pass "no LOG_SERVICE_ADDR without [services] LogService"
fi

echo ""
echo "=== Test 10: a shard above 0 is refused, not given shard 0's address ==="
setup_test_root
sed -i 's|^ACTIVE_DATABASE = .*|&\nLOG_SERVICE_SHARD = 1|' "$TEST_ROOT/config.toml"
sed 's|^#log_dir = .*|log_dir = "/var/local/log/cms"|' "$TEST_ROOT/config/cms.sample.toml" \
  > "$TEST_ROOT/config/cms.toml"
if run_sync; then sync_code=0; else sync_code=$?; fi
assert_exit 1 "$sync_code" "sync exits 1 with LOG_SERVICE_SHARD = 1"
assert_grep "$TEST_ROOT/sync-output.log" 'LOG_SERVICE_SHARD is 1' \
  "the failure names the shard it cannot address"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]]
