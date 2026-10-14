#!/usr/bin/env bash
# tests/test_privileged_helper.sh — pin the one shared privilege-escalation helper.
#
# WHY the helper is tested apart from its callers: every caller used to carry its own
# root check and its own advice, so what has to hold is the contract — run directly as
# root, escalate once through sudo otherwise, and refuse loudly when sudo is absent.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
LIB="${REPO_ROOT}/scripts/__lib/common.sh"
BASH_BIN="$(command -v bash)"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

# Three fake environments: already root, a non-root user with sudo, and one without.
mkdir -p "${SB}/root" "${SB}/user" "${SB}/nosudo"
printf '#!/bin/sh\necho 0\n' > "${SB}/root/id"
printf '#!/bin/sh\necho 1000\n' > "${SB}/user/id"
printf '#!/bin/sh\necho "SUDO:$*"\n' > "${SB}/user/sudo"
printf '#!/bin/sh\necho 1000\n' > "${SB}/nosudo/id"
chmod +x "${SB}/root/id" "${SB}/user/id" "${SB}/user/sudo" "${SB}/nosudo/id"

echo "=== run_privileged ==="
out="$(PATH="${SB}/root" "$BASH_BIN" -c 'source "$0"; run_privileged printf DIRECT' "$LIB")"
[[ "${out}" == "DIRECT" ]] && ok "runs directly when already root" || no "as root produced '${out}'"

out="$(PATH="${SB}/user" "$BASH_BIN" -c 'source "$0"; run_privileged printf VIA' "$LIB")"
[[ "${out}" == "SUDO:printf VIA" ]] && ok "escalates through sudo when not root" || no "produced '${out}'"

out="$(PATH="${SB}/nosudo" "$BASH_BIN" -c 'source "$0"; run_privileged printf NOPE' "$LIB" 2>&1)"
rc=$?
[[ ${rc} -ne 0 ]] && ok "refuses when sudo is absent" || no "exited 0 without a privilege path"
[[ "${out}" == *"run this as root"* ]] && ok "prints the command to run by hand" || no "no instruction: '${out}'"
[[ "${out}" != "NOPE" ]] && ok "runs nothing it could not privilege" || no "ran the command anyway"

mkdir -p "${SB}/noid"
out="$(PATH="${SB}/noid" "$BASH_BIN" -c 'source "$0"; run_privileged printf LEAK' "$LIB" 2>&1)"
[[ "${out}" != "LEAK" ]] && ok "treats an unreadable uid as not root" || no "ran privileged work with no uid"

echo ""
echo "=== run_tailscale ==="
mkdir -p "${SB}/ts" "${SB}/tsfail"
printf '#!/bin/sh\necho 0\n' > "${SB}/ts/tailscale"
printf '#!/bin/sh\necho 0\n' > "${SB}/ts/id"
printf '#!/bin/sh\nexit 1\n' > "${SB}/tsfail/tailscale"
printf '#!/bin/sh\necho "SUDO:$*"\n' > "${SB}/tsfail/sudo"
printf '#!/bin/sh\necho 1000\n' > "${SB}/tsfail/id"
chmod +x "${SB}/ts/tailscale" "${SB}/ts/id" "${SB}/tsfail/tailscale" "${SB}/tsfail/sudo" "${SB}/tsfail/id"
out="$(PATH="${SB}/ts" "$BASH_BIN" -c 'source "$0"; run_tailscale serve status' "$LIB")"
rc=$?
[[ ${rc} -eq 0 ]] && ok "keeps a tailscale call that works unprivileged" || no "escalated a working call"

out="$(PATH="${SB}/tsfail" "$BASH_BIN" -c 'source "$0"; run_tailscale serve status' "$LIB")"
[[ "${out}" == "SUDO:tailscale serve status" ]] && ok "escalates a tailscale call that fails" || no "produced '${out}'"

echo ""
printf 'privileged-helper: %d passed, %d failed\n' "${pass}" "${fail}"
[[ ${fail} -eq 0 ]]
