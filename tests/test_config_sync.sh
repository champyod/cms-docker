#!/usr/bin/env bash
# tests/test_config_sync.sh — regression tests for db-profile migration and
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

assert_not_grep() {
  local file="$1" pattern="$2" label="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then fail "$label (pattern '$pattern' unexpectedly found in $file)"; else pass "$label"; fi
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
  # `cms` resolves its root from its own path and then runs `scripts/__config_sync.sh`
  # relative to that root, so a copy is what keeps `db use` inside the throwaway tree.
  # Without it the test wrote config.toml, .env and config/cms.toml into the checkout —
  # and a suite reading that generated cms.toml fails on it.
  mkdir -p "$TEST_ROOT/scripts"
  cp "$REPO_ROOT/cms" "$TEST_ROOT/cms"
  cp "$REPO_ROOT/scripts/__config_sync.sh" "$TEST_ROOT/scripts/"
  cp -r "$REPO_ROOT/scripts/__lib" "$TEST_ROOT/scripts/"
}

run_sync() {
  CMS_DOCKER_ROOT="$TEST_ROOT" bash "$REPO_ROOT/scripts/__config_sync.sh" "$@" \
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
echo "=== Test 6: cmd_db_use on old layout suggests config sync ==="
write_old_layout
if [[ -f "$REPO_ROOT/config.toml" ]]; then
  repo_config_before="$(sha256sum "$REPO_ROOT/config.toml")"
else
  repo_config_before="(absent)"
fi
(
  cd "$TEST_ROOT"
  bash "$TEST_ROOT/cms" db use default
) > "$TEST_ROOT/db-use.log" 2>&1 || true
assert_grep "$TEST_ROOT/db-use.log" "config sync" "cmd_db_use suggests running config sync"
assert_grep "$TEST_ROOT/config.toml" 'ACTIVE_DATABASE = "default"' "the sandbox config.toml was the one db use rewrote"
if [[ -f "$REPO_ROOT/config.toml" ]]; then
  repo_config_after="$(sha256sum "$REPO_ROOT/config.toml")"
else
  repo_config_after="(absent)"
fi
if [[ "$repo_config_before" == "$repo_config_after" ]]; then
  pass "the checkout's config.toml was left untouched"
else
  fail "db use rewrote the checkout's config.toml — the test is not isolated"
fi

echo ""
echo "=== Test 7: dry-run does not modify config.toml ==="
setup_test_root
cp "$TEST_ROOT/config.toml" "$TEST_ROOT/config.toml.before"
run_sync --dry-run
if diff -q "$TEST_ROOT/config.toml" "$TEST_ROOT/config.toml.before" >/dev/null 2>&1; then
  pass "dry-run leaves config.toml unchanged"
else
  fail "dry-run modified config.toml"
fi

echo ""
echo "=== Test 8: retired ACME keys move onto the ACME_* namespace ==="
setup_test_root
# Written after the [core] block so CERTBOT_IMAGE is still inside it when the pass runs.
cat >> "$TEST_ROOT/config.toml" <<'TOML'
CERTBOT_IMAGE = "certbot/dns-cloudflare"

[admin]
DNS_PROVIDER = "cloudflare"
DNS_CREDENTIALS_FILE = "/etc/lego/cloudflare.ini"
TOML
sync_rc=0
run_sync || sync_rc=$?
assert_exit 0 "$sync_rc" "sync with retired ACME keys exits 0"
assert_not_grep "$TEST_ROOT/config.toml" '^DNS_PROVIDER' "DNS_PROVIDER line is gone"
assert_not_grep "$TEST_ROOT/config.toml" '^DNS_CREDENTIALS_FILE' "DNS_CREDENTIALS_FILE line is gone"
assert_not_grep "$TEST_ROOT/config.toml" '^CERTBOT_IMAGE' "CERTBOT_IMAGE line is gone"
assert_grep "$TEST_ROOT/config.toml" 'ACME_DNS_PROVIDER = "cloudflare"' "the DNS provider value was carried across"
assert_grep "$TEST_ROOT/config.toml" 'ACME_DNS_CREDENTIALS_FILE = "/etc/lego/cloudflare.ini"' "the credentials path was carried across"
assert_grep "$TEST_ROOT/config.toml" 'ACME_CERTBOT_IMAGE = "certbot/dns-cloudflare"' "the certbot image was carried across"
if [[ -f "$TEST_ROOT/.env" ]]; then
  assert_grep "$TEST_ROOT/.env" '^ACME_DNS_PROVIDER=cloudflare' ".env carries the DNS provider under its new name"
  assert_grep "$TEST_ROOT/.env" '^ACME_CERTBOT_IMAGE=certbot/dns-cloudflare' ".env carries the certbot image under its new name"
  assert_not_grep "$TEST_ROOT/.env" '^CERTBOT_IMAGE=' ".env no longer carries the old certbot image name"
else
  fail ".env was not created for the ACME migration"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]]
