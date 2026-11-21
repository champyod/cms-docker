#!/usr/bin/env bash
# tests/test_config_cross_section.sh — one key, two sections, one .env slot.
#
# A key in two sections is one .env slot. The sync now drops the stale copy from the
# live config.toml and reports it (see drop_stale_section_copies and test_config_sync.sh
# Test 13), so the .env carries the setting once and the report names what it removed.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cms-config-xsection.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

mkdir -p "$TEST_ROOT/config"
cp "$REPO_ROOT/config.toml.example" "$TEST_ROOT/config.toml.example"
cp "$REPO_ROOT/config/"*.sample.toml "$TEST_ROOT/config/" 2>/dev/null || true
cat > "$TEST_ROOT/config.toml" <<'TOML'
[core]
COMPOSE_PROJECT_NAME = "cms"
CMS_DOMAIN = "cms.local"
ACCESS_METHOD = "public_port"

[contest]
ACCESS_METHOD = "domain"
TOML

CMS_DOCKER_ROOT="$TEST_ROOT" bash "$REPO_ROOT/scripts/__config_sync.sh" > "$TEST_ROOT/out.log" 2>&1 || true

printf '\n== a key in two sections is written once, from the first ==\n'
count="$(grep -c '^ACCESS_METHOD=' "$TEST_ROOT/.env" 2>/dev/null || printf '0')"
if [[ "$count" -eq 1 ]]; then ok "the .env carries ACCESS_METHOD once"; else no "the .env carries ACCESS_METHOD once (found ${count})"; fi
if grep -qx 'ACCESS_METHOD=public_port' "$TEST_ROOT/.env" 2>/dev/null; then ok "the first section's value wins"; else no "the first section's value wins"; fi
if grep -q 'removed stale ACCESS_METHOD from \[contest\]' "$TEST_ROOT/out.log" 2>/dev/null; then ok "the duplicate is reported"; else no "the duplicate is reported"; fi
if ! grep -q '^ACCESS_METHOD' <(awk '/^\[contest\]/{f=1;next} /^\[/{f=0} f' "$TEST_ROOT/config.toml") 2>/dev/null; then ok "the stale copy is gone from config.toml"; else no "the stale copy is gone from config.toml"; fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
