#!/usr/bin/env bash
# tests/test_generated_dir_perms.sh — the deploy hands config/generated to the reconciler.
#
# WHY: the exposure reconciler renders the front's vhosts into config/generated from inside a
# container, as the panel image's `node` user, while the directory belongs to whoever ran the deploy.
# Its first real tick in production read the registry and then refused:
#   EACCES: permission denied, mkdir '/repo-root/config/generated/.staging'
# keeping the front's previous config — safe, silent, and doing nothing.
#
# The repair has to satisfy two identities at once: the reconciler (owner) and the deploy (group
# member, because __domain.sh writes exposed-hosts.txt there). Neither passwordless sudo nor setfacl
# exists on that host, so the repair goes through the docker daemon, which is root.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BASH_BIN="$(command -v bash)"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "${SB}/bin"

# docker records its argv; the repair sends the helper's output to /dev/null, so the log is the only
# evidence that the privileged path ran at all.
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\nexit 0\n' "${SB}/docker.log" > "${SB}/bin/docker"
printf '#!/bin/sh\nexit 0\n' > "${SB}/bin/sudo"
chmod +x "${SB}/bin/docker" "${SB}/bin/sudo"

run_repair() { # <panel_uid> [PATH prefix]
  PATH="${2:-${SB}/bin:${PATH}}" PANEL_UID="$1" "${BASH_BIN}" -c '
    source "$0"
    log_warn() { printf "WARN:%s\n" "$*" >&2; }
    ensure_generated_dir_perms "$1"
  ' "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}" 2>&1
}

CURRENT_UID="$(id -u)"
CURRENT_GID="$(id -g)"

printf '\n== the directory the reconciler needs ==\n'
: > "${SB}/docker.log"
out="$(run_repair 1000)"
if [[ -d "${SB}/config/generated" ]]; then ok "config/generated is created"; else no "config/generated is created"; fi
if grep -Fq "chown -R 1000:${CURRENT_GID} /g" "${SB}/docker.log"; then
  ok "the directory is handed to the panel uid, group = the deploy's group"
else
  no "ownership goes to the panel uid in the deploy's group (saw: $(tr '\n' ';' < "${SB}/docker.log" || true))"
fi
if grep -Fq "chmod -R u+rwX,g+rwX /g" "${SB}/docker.log"; then
  ok "the deploy keeps write access as a group member"
else
  no "the deploy keeps write access (saw: $(tr '\n' ';' < "${SB}/docker.log" || true))"
fi
if printf '%s' "$out" | grep -Fq 'SUDO:'; then
  no "a repair that can use docker does not escalate with sudo"
else
  ok "a repair that can use docker does not escalate with sudo"
fi

printf '\n== the panel uid follows PANEL_UID ==\n'
: > "${SB}/docker.log"
run_repair 1234 >/dev/null 2>&1 || true
if grep -Fq "chown -R 1234:" "${SB}/docker.log"; then
  ok "a rebuilt image's uid is honoured (PANEL_UID)"
else
  no "a rebuilt image's uid is honoured (saw: $(tr '\n' ';' < "${SB}/docker.log" || true))"
fi

printf '\n== a directory that is already correct is left alone ==\n'
: > "${SB}/docker.log"
mkdir -p "${SB}/config/generated"
chmod 775 "${SB}/config/generated"
# Only meaningful when this test can set the directory's owner; as a normal user it cannot, and the
# repair is then entitled to run. Say so rather than claiming a pass it did not earn.
if chown "${CURRENT_UID}:${CURRENT_GID}" "${SB}/config/generated" 2>/dev/null; then
  : > "${SB}/docker.log"
  run_repair "${CURRENT_UID}" >/dev/null 2>&1 || true
  if [[ -s "${SB}/docker.log" ]]; then
    no "an already-correct directory costs no repair (saw: $(tr '\n' ';' < "${SB}/docker.log"))"
  else
    ok "an already-correct directory costs no repair"
  fi
else
  ok "already-correct case skipped: this shell cannot chown (uid $(id -u)), so it cannot arrange it"
fi

printf '\n== docker unreachable falls back and says so ==\n'
# WHY a uid other than 1000: on a host where the test shell *is* uid 1000, a chown to 1000 succeeds
# and the fallback never has to warn — the case would pass for the wrong reason.
# Daemon down AND no way to escalate: the repair must say so rather than report a directory it never
# handed over. A stubbed sudo that succeeds would be the other, quieter outcome — asserted next.
printf '#!/bin/sh\nexit 1\n' > "${SB}/bin/docker"
printf '#!/bin/sh\nexit 1\n' > "${SB}/bin/sudo"
chmod +x "${SB}/bin/docker" "${SB}/bin/sudo"
FOREIGN_UID=$(( CURRENT_UID + 7 ))
out="$(run_repair "$FOREIGN_UID")"
if printf '%s' "$out" | grep -Fq 'WARN:config/generated may stay unwritable'; then
  ok "an unreachable daemon that also cannot chown warns instead of pretending"
else
  no "an unreachable daemon warns (saw: ${out:-nothing})"
fi

printf '\n== docker unreachable, but sudo works ==\n'
printf '#!/bin/sh\nexit 1\n' > "${SB}/bin/docker"
printf '#!/bin/sh\nprintf "SUDO:%%s\\n" "$*"\nexit 0\n' > "${SB}/bin/sudo"
chmod +x "${SB}/bin/docker" "${SB}/bin/sudo"
out="$(run_repair "$FOREIGN_UID")"
if printf '%s' "$out" | grep -Fq "SUDO:chown -R ${FOREIGN_UID}:"; then
  ok "a dead daemon still hands the directory over through sudo"
else
  no "a dead daemon falls back to sudo (saw: ${out:-nothing})"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
