#!/usr/bin/env bash
# tests/test_var_coverage.sh — sandbox env names must have real lowercase sources.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cms-var-coverage-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PASS=0
FAIL=0
pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

setup_test_root() {
  rm -rf -- "$TEST_ROOT"
  mkdir -p "$TEST_ROOT/scripts/__lib" "$TEST_ROOT/config"
  cp "$REPO_ROOT/scripts/__check_var_coverage.sh" "$TEST_ROOT/scripts/"
  cp "$REPO_ROOT/scripts/__lib/common.sh" "$TEST_ROOT/scripts/__lib/"
  cp "$REPO_ROOT/config.toml.example" "$TEST_ROOT/"
  cp "$REPO_ROOT/config/cms.sample.toml" "$TEST_ROOT/config/"
  cat > "$TEST_ROOT/docker-compose.yml" <<'YAML'
services:
  worker:
    environment:
      COMPILATION_SANDBOX_MAX_PROCESSES: ${COMPILATION_SANDBOX_MAX_PROCESSES:-1000}
      COMPILATION_SANDBOX_MAX_TIME_S: ${COMPILATION_SANDBOX_MAX_TIME_S:-10.0}
      COMPILATION_SANDBOX_MAX_MEMORY_KIB: ${COMPILATION_SANDBOX_MAX_MEMORY_KIB:-524288}
      TRUSTED_SANDBOX_MAX_PROCESSES: ${TRUSTED_SANDBOX_MAX_PROCESSES:-1000}
      TRUSTED_SANDBOX_MAX_TIME_S: ${TRUSTED_SANDBOX_MAX_TIME_S:-10.0}
      TRUSTED_SANDBOX_MAX_MEMORY_KIB: ${TRUSTED_SANDBOX_MAX_MEMORY_KIB:-4194304}
YAML
}

run_gate() {
  bash "$TEST_ROOT/scripts/__check_var_coverage.sh" > "$TEST_ROOT/gate.log" 2>&1
}

echo "=== Test 1: mapped sandbox sources cover their env names ==="
setup_test_root
if run_gate; then gate_code=0; else gate_code=$?; fi
if [[ "$gate_code" -eq 0 ]]; then
  pass "derived sandbox variables pass with their source keys present"
else
  fail "derived sandbox variables failed with their source keys present (exit $gate_code)"
fi
if grep -q '^\[WARN\]' "$TEST_ROOT/gate.log"; then
  fail "mapped sandbox variables produced a warning"
else
  pass "mapped sandbox variables produced no warning"
fi

echo ""
echo "=== Test 2: a missing mapped source key warns for that variable ==="
setup_test_root
grep -v '^trusted_sandbox_max_time_s = ' "$TEST_ROOT/config/cms.sample.toml" \
  > "$TEST_ROOT/config/cms.sample.toml.new"
mv "$TEST_ROOT/config/cms.sample.toml.new" "$TEST_ROOT/config/cms.sample.toml"
if run_gate; then gate_code=0; else gate_code=$?; fi
if [[ "$gate_code" -eq 1 ]]; then
  pass "a missing mapped source key fails coverage"
else
  fail "a missing mapped source key must exit 1, got $gate_code"
fi
if grep -Fq 'compose uses ${TRUSTED_SANDBOX_MAX_TIME_S} but config/cms.sample.toml has no [sandbox] trusted_sandbox_max_time_s' "$TEST_ROOT/gate.log"; then
  pass "the warning names the variable and its missing sandbox source"
else
  fail "the warning did not name the missing sandbox source"
fi
if [[ "$(grep -c '^\[WARN\]' "$TEST_ROOT/gate.log")" -eq 1 ]]; then
  pass "only the variable whose source disappeared warns"
else
  fail "a missing source key warned for more than its own variable"
fi

echo ""
echo "=== Test 3: the mapped key must be inside [sandbox] ==="
setup_test_root
grep -v '^trusted_sandbox_max_time_s = ' "$TEST_ROOT/config/cms.sample.toml" \
  > "$TEST_ROOT/config/cms.sample.toml.new"
printf '\n[unrelated]\ntrusted_sandbox_max_time_s = 10.0\n' >> "$TEST_ROOT/config/cms.sample.toml.new"
mv "$TEST_ROOT/config/cms.sample.toml.new" "$TEST_ROOT/config/cms.sample.toml"
if run_gate; then gate_code=0; else gate_code=$?; fi
if [[ "$gate_code" -eq 1 ]]; then
  pass "a mapped key outside [sandbox] fails coverage"
else
  fail "a mapped key outside [sandbox] must exit 1, got $gate_code"
fi
if grep -Fq 'compose uses ${TRUSTED_SANDBOX_MAX_TIME_S} but config/cms.sample.toml has no [sandbox] trusted_sandbox_max_time_s' "$TEST_ROOT/gate.log"; then
  pass "the warning proves the mapping is section-scoped"
else
  fail "the mapping accepted a key outside [sandbox]"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]]
