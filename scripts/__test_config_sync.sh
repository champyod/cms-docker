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
echo "=== Test 11: .env carries the resource service's three inputs ==="
setup_test_root
sed 's|^#log_dir = .*|log_dir = "/var/local/log/cms"|' "$TEST_ROOT/config/cms.sample.toml" \
  > "$TEST_ROOT/config/cms.toml"
run_sync
assert_exit 0 $? "real run with a rendered cms.toml exits 0"
assert_grep "$TEST_ROOT/.env" '^RESOURCE_SERVICE_ADDR=cms-resource-service:28000$' \
  ".env RESOURCE_SERVICE_ADDR is the [services] ResourceService shard"
assert_grep "$TEST_ROOT/.env" '^RESOURCE_SERVICE_COORD=ResourceService,0$' \
  ".env RESOURCE_SERVICE_COORD is the shard the list holds"
assert_grep "$TEST_ROOT/.env" 'LogService|0|cms-log-service|29000' \
  "CMS_SERVICES carries the LogService shard"
assert_grep "$TEST_ROOT/.env" 'ResourceService|0|cms-resource-service|28000' \
  "CMS_SERVICES carries the ResourceService shard"
if grep -q '^Worker|' "$TEST_ROOT/.env"; then
  fail "CMS_SERVICES invented a Worker row although the Worker list is commented out"
else
  pass "no CMS_SERVICES row for a service the [services] table does not run"
fi
# WHY source it: the table is one multi-line value, and every shell reader of .env must get all of it.
sourced_services="$(set -a; . "$TEST_ROOT/.env" >/dev/null 2>&1; printf '%s' "$CMS_SERVICES")"
if [[ "$(printf '%s\n' "$sourced_services" | head -1)" == "LogService|0|cms-log-service|29000" ]] \
   && [[ "$(printf '%s\n' "$sourced_services" | wc -l)" -ge 2 ]]; then
  pass "sourcing .env gives CMS_SERVICES as one value of one line per shard"
else
  fail "CMS_SERVICES did not survive being sourced (got: $(printf '%s' "$sourced_services" | head -3 | tr '\n' ' '))"
fi
# WHY: the contest, the flag and BIN_PATH are container wiring, not cms.toml keys.
for not_rendered in CMS_AUTORESTART CMS_CONTEST_ID CMS_BIN_PATH; do
  if grep -q "^${not_rendered}=" "$TEST_ROOT/.env"; then
    fail "${not_rendered} was emitted although no cms.toml key derives it"
  else
    pass "no ${not_rendered} in .env"
  fi
done

echo ""
echo "=== Test 12: a second shard is a second line, at its own index ==="
setup_test_root
sed 's|^ScoringService = .*|ScoringService = [["cms-scoring-service", 28500], ["cms-scoring-service-2", 28501]]|' \
  "$TEST_ROOT/config/cms.sample.toml" > "$TEST_ROOT/config/cms.toml"
run_sync
assert_exit 0 $? "a two-shard service still syncs"
assert_grep "$TEST_ROOT/.env" 'ScoringService|0|cms-scoring-service|28500' \
  "the first shard keeps index 0"
assert_grep "$TEST_ROOT/.env" 'ScoringService|1|cms-scoring-service-2|28501' \
  "the second shard is index 1, not the first one's address"

echo ""
echo "=== Test 13: a missing [services] ResourceService stops the sync ==="
setup_test_root
grep -v '^ResourceService = ' "$TEST_ROOT/config/cms.sample.toml" > "$TEST_ROOT/config/cms.toml"
if run_sync; then sync_code=0; else sync_code=$?; fi
assert_exit 1 "$sync_code" "sync exits 1 without [services] ResourceService"
assert_grep "$TEST_ROOT/sync-output.log" 'has no \[services\] ResourceService shard 0' \
  "the failure names the missing entry and shard"
if grep -q '^RESOURCE_SERVICE_ADDR=' "$TEST_ROOT/.env" 2>/dev/null; then
  fail "RESOURCE_SERVICE_ADDR emitted without [services] ResourceService"
else
  pass "no RESOURCE_SERVICE_ADDR without [services] ResourceService"
fi

echo ""
echo "=== Test 14: a resource service shard the table does not hold is refused ==="
setup_test_root
sed -i 's|^ACTIVE_DATABASE = .*|&\nRESOURCE_SERVICE_SHARD = 1|' "$TEST_ROOT/config.toml"
sed 's|^#log_dir = .*|log_dir = "/var/local/log/cms"|' "$TEST_ROOT/config/cms.sample.toml" \
  > "$TEST_ROOT/config/cms.toml"
if run_sync; then sync_code=0; else sync_code=$?; fi
assert_exit 1 "$sync_code" "sync exits 1 with RESOURCE_SERVICE_SHARD = 1"
assert_grep "$TEST_ROOT/sync-output.log" 'ResourceService shard 1' \
  "the failure names the shard it cannot address"

echo ""
echo "=== Test 15: .env carries distinct [sandbox] worker limits ==="
setup_test_root
sed \
  -e 's/^max_file_size = .*/max_file_size = 2_097_152/' \
  -e 's/^compilation_sandbox_max_processes = .*/compilation_sandbox_max_processes = 17/' \
  -e 's/^compilation_sandbox_max_time_s = .*/compilation_sandbox_max_time_s = 2.5/' \
  -e 's/^compilation_sandbox_max_memory_kib = .*/compilation_sandbox_max_memory_kib = 262_144/' \
  -e 's/^trusted_sandbox_max_processes = .*/trusted_sandbox_max_processes = 23/' \
  -e 's/^trusted_sandbox_max_time_s = .*/trusted_sandbox_max_time_s = 7.25/' \
  -e 's/^trusted_sandbox_max_memory_kib = .*/trusted_sandbox_max_memory_kib = 8_388_608/' \
  "$TEST_ROOT/config/cms.sample.toml" > "$TEST_ROOT/config/cms.toml"
run_sync
assert_exit 0 $? "real run with [sandbox] worker limits exits 0"
assert_grep "$TEST_ROOT/.env" '^MAX_FILE_SIZE=2097152$' ".env MAX_FILE_SIZE is [sandbox] max_file_size"
assert_grep "$TEST_ROOT/.env" '^COMPILATION_SANDBOX_MAX_PROCESSES=17$' ".env compilation process limit is distinct"
assert_grep "$TEST_ROOT/.env" '^COMPILATION_SANDBOX_MAX_TIME_S=2.5$' ".env compilation time limit is distinct"
assert_grep "$TEST_ROOT/.env" '^COMPILATION_SANDBOX_MAX_MEMORY_KIB=262144$' ".env compilation memory limit is distinct"
assert_grep "$TEST_ROOT/.env" '^TRUSTED_SANDBOX_MAX_PROCESSES=23$' ".env trusted process limit is distinct"
assert_grep "$TEST_ROOT/.env" '^TRUSTED_SANDBOX_MAX_TIME_S=7.25$' ".env trusted time limit is distinct"
assert_grep "$TEST_ROOT/.env" '^TRUSTED_SANDBOX_MAX_MEMORY_KIB=8388608$' ".env trusted memory limit is distinct"
worker_blocks="$(grep -c '^### \[worker\] ###$' "$TEST_ROOT/.env")"
if [[ "$worker_blocks" -eq 2 ]]; then
  pass "sandbox limits add one [worker] block beside config.toml's worker block"
else
  fail "expected two [worker] blocks with [sandbox], got $worker_blocks"
fi
if [[ "$(grep -c '^RPC_SECRET=.' "$TEST_ROOT/.env")" -eq 1 ]]; then
  pass "worker rendering leaves the single RPC_SECRET line untouched"
else
  fail "worker rendering changed the RPC_SECRET line count"
fi
if grep -q '^DATABASE_URL=' "$TEST_ROOT/.env"; then
  fail "worker rendering invented a root DATABASE_URL"
else
  pass "worker rendering leaves DATABASE_URL to compose"
fi

echo ""
echo "=== Test 16: no [sandbox] table adds no worker env block ==="
setup_test_root
awk '
  /^\[sandbox\][[:space:]]*$/ { skip = 1; next }
  /^\[/ { skip = 0 }
  !skip { print }
' "$TEST_ROOT/config/cms.sample.toml" > "$TEST_ROOT/config/cms.toml"
run_sync
assert_exit 0 $? "real run without [sandbox] exits 0"
worker_blocks="$(grep -c '^### \[worker\] ###$' "$TEST_ROOT/.env")"
if [[ "$worker_blocks" -eq 1 ]]; then
  pass "no extra [worker] block without [sandbox]"
else
  fail "expected only config.toml's [worker] block without [sandbox], got $worker_blocks"
fi
for worker_variable in COMPILATION_SANDBOX_MAX_PROCESSES \
  COMPILATION_SANDBOX_MAX_TIME_S COMPILATION_SANDBOX_MAX_MEMORY_KIB \
  TRUSTED_SANDBOX_MAX_PROCESSES TRUSTED_SANDBOX_MAX_TIME_S \
  TRUSTED_SANDBOX_MAX_MEMORY_KIB; do
  if grep -q "^${worker_variable}=" "$TEST_ROOT/.env"; then
    fail "${worker_variable} emitted without a [sandbox] key"
  else
    pass "no ${worker_variable} without a [sandbox] key"
  fi
done
if [[ "$(grep -c '^MAX_FILE_SIZE=' "$TEST_ROOT/.env")" -eq 1 ]]; then
  pass "no second MAX_FILE_SIZE without [sandbox]"
else
  fail "worker rendering added MAX_FILE_SIZE without [sandbox]"
fi

echo ""
echo "=== Test 17: a partial [sandbox] table invents no missing limits ==="
setup_test_root
awk '
  /^\[sandbox\][[:space:]]*$/ { in_sandbox = 1; print; next }
  /^\[/ { in_sandbox = 0 }
  in_sandbox && /^max_file_size[[:space:]]*=/ { print; next }
  in_sandbox { next }
  { print }
' "$TEST_ROOT/config/cms.sample.toml" > "$TEST_ROOT/config/cms.toml"
run_sync
assert_exit 0 $? "real run with one [sandbox] key exits 0"
assert_grep "$TEST_ROOT/.env" '^MAX_FILE_SIZE=1048576$' ".env keeps the one present sandbox value"
if [[ "$(grep -c '^MAX_FILE_SIZE=' "$TEST_ROOT/.env")" -eq 2 ]]; then
  pass "the present sandbox key appends its MAX_FILE_SIZE line"
else
  fail "the present sandbox key did not append MAX_FILE_SIZE"
fi
for worker_variable in COMPILATION_SANDBOX_MAX_PROCESSES \
  COMPILATION_SANDBOX_MAX_TIME_S COMPILATION_SANDBOX_MAX_MEMORY_KIB \
  TRUSTED_SANDBOX_MAX_PROCESSES TRUSTED_SANDBOX_MAX_TIME_S \
  TRUSTED_SANDBOX_MAX_MEMORY_KIB; do
  if grep -q "^${worker_variable}=" "$TEST_ROOT/.env"; then
    fail "${worker_variable} invented for an absent [sandbox] key"
  else
    pass "no invented ${worker_variable} for an absent key"
  fi
done

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]]
