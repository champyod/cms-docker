#!/usr/bin/env bash
# tests/test_ranking_paths_perms.sh — the deploy hands the ranking paths to the panel.
#
# WHY: the panel uploads the ranking logo as the image's `node` user (uid 1000), but the
# deploy creates the cms-ranking-data volume and the config/assets mirror through a root
# helper, so both stay root-owned and the upload always fails. The repair has to hand all
# three paths to the panel uid, quietly when they are already correct, and escalate once
# when they are not.
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

mkdir -p "${SB}/bin" "${SB}/config"

# docker records to a file because the repair redirects the helper's own output to
# /dev/null; sudo records on stdout, which the caller can read.
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\nexit 0\n' "${SB}/docker.log" > "${SB}/bin/docker"
printf '#!/bin/sh\nprintf "SUDO:%%s\\n" "$*"\nexit 0\n' > "${SB}/bin/sudo"
chmod +x "${SB}/bin/docker" "${SB}/bin/sudo"

run_repair() { # <panel_uid>
  PATH="${SB}/bin:${PATH}" PANEL_UID="$1" "$BASH_BIN" -c '
    source "$0"
    log_warn() { printf "WARN:%s\n" "$*" >&2; }
    ensure_ranking_paths_perms "$1"
  ' "${REPO_ROOT}/scripts/__lib/common.sh" "${SB}" 2>&1
}

CURRENT_UID="$(id -u)"
CURRENT_GID="$(id -g)"
OTHER_UID=$(( CURRENT_UID + 1 ))

printf '\n== a deploy that already owns the host paths ==\n'
: > "${SB}/config.toml"
: > "${SB}/docker.log"
chmod 664 "${SB}/config.toml"
out="$(run_repair "$CURRENT_UID")"

if grep -Fq "chown -R ${CURRENT_UID}:${CURRENT_UID} /data" "${SB}/docker.log"; then
  ok "the cms-ranking-data volume is handed to the panel uid"
else
  no "the volume is handed to the panel uid (saw: $(tr '\n' ';' < "${SB}/docker.log" || true))"
fi
if [[ -d "${SB}/config/assets" ]]; then ok "the config/assets mirror exists"; else no "the config/assets mirror exists"; fi

mode="$(stat -c '%a' "${SB}/config.toml" 2>/dev/null || true)"
if [[ "${mode: -3}" =~ ^.[2367].$ ]]; then ok "config.toml is group-writable for the panel"; else no "config.toml is group-writable (mode ${mode})"; fi
if [[ "$(stat -c '%g' "${SB}/config.toml")" == "$CURRENT_UID" ]]; then ok "config.toml carries the panel group"; else no "config.toml carries the panel group"; fi
if [[ "$CURRENT_UID" == "$CURRENT_GID" ]] && ! printf '%s' "$out" | grep -Fq 'SUDO:'; then
  ok "a repair that is already correct prompts for nothing"
elif [[ "$CURRENT_UID" != "$CURRENT_GID" ]]; then
  ok "a repair that is already correct prompts for nothing (skipped: uid != gid)"
else
  no "an already-correct repair escalated: ${out}"
fi

printf '\n== a deploy whose host paths belong to another uid ==\n'
: > "${SB}/docker.log"
out="$(run_repair "$OTHER_UID")"
if grep -Fq "chown -R ${OTHER_UID}:${OTHER_UID} /data" "${SB}/docker.log"; then
  ok "the volume follows the panel uid it was given"
else
  no "the volume follows the given panel uid (saw: $(tr '\n' ';' < "${SB}/docker.log" || true))"
fi
if printf '%s' "$out" | grep -Fq "SUDO:chown -R ${OTHER_UID}:${OTHER_UID}"; then
  ok "config/assets is escalated when the operator cannot chown it"
else
  no "config/assets is escalated when needed (saw: ${out:-nothing})"
fi
if printf '%s' "$out" | grep -Fq "SUDO:chgrp ${OTHER_UID}"; then
  ok "config.toml's group is escalated when the operator cannot set it"
else
  no "config.toml's group is escalated when needed (saw: ${out:-nothing})"
fi

printf '\n== summary ==\n'
printf 'PASS: %d  FAIL: %d\n' "$pass" "$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
printf 'ALL PASS\n'
