#!/usr/bin/env bash
# tests/test_worker_status_json.sh — the fleet emitter must read the fleet the container was given
# when .env cannot be read, and must keep reading .env on the host.
set -eu
if (set -o pipefail 2>/dev/null); then set -o pipefail; fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cms-worker-status-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

PASS=0
FAIL=0

pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

assert_contains() { # haystack needle label
  case "$1" in
    *"$2"*) pass "$3" ;;
    *) fail "$3 (wanted '$2' in: $1)" ;;
  esac
}

assert_absent() { # haystack needle label
  case "$1" in
    *"$2"*) fail "$3 (did not expect '$2' in: $1)" ;;
    *) pass "$3" ;;
  esac
}

setup_emitter() {
  rm -rf -- "$TEST_ROOT/scripts" "$TEST_ROOT/bin" "$TEST_ROOT/.env"
  mkdir -p "$TEST_ROOT/scripts" "$TEST_ROOT/bin"
  cp "$REPO_ROOT/scripts/__worker_status_json.sh" "$TEST_ROOT/scripts/"
  # docker is stubbed: this suite is about where the fleet is read from, never about a daemon.
  printf '#!/bin/sh\nexit 1\n' > "$TEST_ROOT/bin/docker"
  chmod +x "$TEST_ROOT/bin/docker"
}

emit() { # [VAR=value ...] -> the emitter's stdout, with nothing else in its environment
  ( cd "$TEST_ROOT" && env -i PATH="$TEST_ROOT/bin:$PATH" HOME="${HOME:-/tmp}" TMPDIR="${TMPDIR:-/tmp}" LC_ALL=C "$@" bash scripts/__worker_status_json.sh )
}

assert_json_rows() { # json row_count label
  if ! command -v python3 >/dev/null 2>&1; then
    pass "$3 (python3 unavailable, not checked)"
    return 0
  fi
  if printf '%s' "$1" | python3 -c "import json,sys; rows=json.load(sys.stdin); assert len(rows)==$2, rows" 2>/dev/null; then
    pass "$3"
  else
    fail "$3 (not $2 valid JSON rows: $1)"
  fi
}

echo "=== Test 1: an unreadable .env still yields the fleet the environment carries ==="
setup_emitter
# A dangling symlink is unreadable to every uid, root included, so the fleet can only come
# from the environment.
ln -s "$TEST_ROOT/absent.env" "$TEST_ROOT/.env"
out="$(emit WORKER_0=127.0.0.1:26000 WORKER_1=127.0.0.1:26001 CONTEST_ID=42)"
assert_json_rows "$out" 2 "the environment's fleet is reported, not an empty array"
assert_contains "$out" '"shard":0' "shard 0 is listed"
assert_contains "$out" '"shard":1' "shard 1 is listed"
assert_contains "$out" '"endpoint":"127.0.0.1:26000"' "the endpoint comes from the environment"
assert_contains "$out" '"contest":42' "CONTEST_ID is read from the environment too"

echo ""
echo "=== Test 2: a readable .env still supplies the fleet on the host ==="
setup_emitter
printf 'WORKER_3=cms-worker-3:26003\n' > "$TEST_ROOT/.env"
out="$(emit)"
assert_json_rows "$out" 1 "the file's fleet is reported"
assert_contains "$out" '"endpoint":"cms-worker-3:26003"' "the endpoint comes from the file"
assert_contains "$out" '"shard":3' "shard 3 is listed"

echo ""
echo "=== Test 3: the environment wins per key, the file still supplies the rest ==="
setup_emitter
printf 'WORKER_0=cms-worker-0:26000\nWORKER_3=cms-worker-3:26003\n' > "$TEST_ROOT/.env"
out="$(emit WORKER_0=10.0.0.5:26005)"
assert_json_rows "$out" 2 "both keys are reported once each"
assert_contains "$out" '"endpoint":"10.0.0.5:26005"' "the environment's value is the one used"
assert_absent "$out" 'cms-worker-0:26000' "the file's copy of that key is not used as well"
assert_contains "$out" '"endpoint":"cms-worker-3:26003"' "a key only the file carries is still read"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]]
