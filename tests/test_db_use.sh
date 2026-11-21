#!/usr/bin/env bash
# tests/test_db_use.sh — pin the profile switch scripts/__db_use.sh performs.
#
# WHY stubs: the real path reads config.toml, runs config sync and restarts docker
# stacks. config sync and docker/make are stubbed, so what is asserted is the
# decision the script makes and the config mutation it writes.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
DB_USE="${REPO_ROOT}/scripts/__db_use.sh"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SANDBOXES=()
cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

new_sandbox() {
  SB="$(mktemp -d)"
  SANDBOXES+=("${SB}")
  mkdir -p "${SB}/scripts" "${SB}/bin"
  cp "${DB_USE}" "${SB}/scripts/"
  cat > "${SB}/scripts/__config_sync.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "sync" >> "${STUB_SYNC_LOG:-/dev/null}"
exit 0
STUB
  cat > "${SB}/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "${1:-}" == "ps" ]]; then printf '%s\n' "${STUB_PS:-}"; fi
exit 0
STUB
  cat > "${SB}/bin/make" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${STUB_MAKE_LOG:-/dev/null}"
exit 0
STUB
  chmod +x "${SB}/scripts/__db_use.sh" "${SB}/scripts/__config_sync.sh" "${SB}/bin/docker" "${SB}/bin/make"
  : > "${SB}/sync.log"
  : > "${SB}/make.log"
}

write_config() { # <active>
  cat > "${SB}/config.toml" <<EOF
[core]
ACTIVE_DATABASE = "$1"

[db_default]
POSTGRES_DB = "cmsdb"

[db_evaluate]
POSTGRES_DB = "cmsdb_evaluate"
EOF
}

run_use() {
  OUT="$(PATH="${SB}/bin:${PATH}" STUB_SYNC_LOG="${SB}/sync.log" STUB_MAKE_LOG="${SB}/make.log" \
    bash "${SB}/scripts/__db_use.sh" "$@" 2>&1)"
  RC=$?
}

has() { if printf '%s\n' "$OUT" | grep -Fq -- "$2"; then ok "$1"; else no "$1 (missing: $2)"; fi; }
active() { awk '/^\[core\]/{c=1} /^\[/ && !/^\[core\]/{c=0} c && /^ACTIVE_DATABASE/{print; exit}' "${SB}/config.toml"; }

printf '\n== a name that cannot be used is refused ==\n'
new_sandbox
write_config default
run_use
if [[ "$RC" -eq 1 ]]; then ok "a missing name is refused"; else no "a missing name is refused (got ${RC})"; fi
has "and prints usage" "Usage:"

new_sandbox
write_config default
run_use "bad name"
if [[ "$RC" -eq 1 ]]; then ok "an invalid profile name is refused"; else no "an invalid profile name is refused (got ${RC})"; fi
has "and names the invalid value" "invalid profile name"

new_sandbox
write_config default
run_use nope
if [[ "$RC" -eq 1 ]]; then ok "an unknown profile is refused"; else no "an unknown profile is refused (got ${RC})"; fi
has "and names the missing section" "no [db_nope] section"
has "and lists what exists" "default"

printf '\n== a valid switch rewrites ACTIVE_DATABASE and syncs ==\n'
new_sandbox
write_config default
run_use evaluate
if [[ "$RC" -eq 0 ]]; then ok "a valid switch exits 0"; else no "a valid switch exits 0 (got ${RC})"; fi
if [[ "$(active)" == 'ACTIVE_DATABASE = "evaluate"' ]]; then ok "ACTIVE_DATABASE now names the profile"; else no "ACTIVE_DATABASE now names the profile (got '$(active)')"; fi
has "and reports the rewrite" 'ACTIVE_DATABASE set to "evaluate"'
if grep -q . "${SB}/sync.log"; then ok "config sync ran"; else no "config sync ran"; fi

printf '\n== an already-active profile changes nothing ==\n'
new_sandbox
write_config default
run_use default
if [[ "$RC" -eq 0 ]]; then ok "re-selecting the active profile exits 0"; else no "re-selecting the active profile exits 0 (got ${RC})"; fi
has "and says no change is needed" "already"

printf '\n== running stacks are restarted, idle hosts are not ==\n'
new_sandbox
write_config default
run_use evaluate >/dev/null 2>&1
has "with nothing running it says so" "No running CMS stacks"
if [[ -s "${SB}/make.log" ]]; then no "it runs no make when nothing is up"; else ok "it runs no make when nothing is up"; fi

new_sandbox
write_config default
export STUB_PS="cms-database"
run_use evaluate
unset STUB_PS
has "with a running stack it restarts" "Restarting affected stacks"
if grep -qx "core" "${SB}/make.log"; then ok "it recreates the core stack"; else no "it recreates the core stack (got '$(tr '\n' ' ' < "${SB}/make.log")')"; fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
