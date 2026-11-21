#!/usr/bin/env bash
# Drives scripts/__cert_timer.sh against a sandboxed HOME so the real
# ~/.config/systemd/user and the real units are never touched.
#
# WHY this exists: the units in config/systemd/ ship an @CMS_DIR@ placeholder, and
# the only substituter that used to reach them (src/install.py) substitutes `~/cms`,
# which this fork does not have, from a verb nothing on the host calls. A unit
# carrying the placeholder literally cannot be installed, so renewal never fired
# and no test failed. This asserts the substitution actually happens, and that a
# run without --apply writes nothing.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CERT_TIMER="${REPO_ROOT}/scripts/__cert_timer.sh"

pass=0
fail=0
# One sandbox for the whole run: every case only writes inside its own HOME, so
# they can share the tree without one of them seeing another's files.
SANDBOXES=()

ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
no() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }

cleanup() { rm -rf "${SANDBOXES[@]+"${SANDBOXES[@]}"}"; }
trap cleanup EXIT

# A copy of the checkout pieces the script reaches for, plus stubs for the two
# commands it shells out to.
# WHY stubs rather than the real systemctl: `enable --now` against a real user
# systemd would schedule a real certificate renewal, and the sandbox HOME holds
# no units that unit manager would accept anyway.
# WHY the real Makefile and ./cms are copied rather than stubbed: the script's
# repo-root walk looks for exactly those two, so a hand-made pair would test the
# stub rather than the checkout shape it has to find.
sandbox() {
  local dir
  dir="$(mktemp -d)"
  SANDBOXES+=("${dir}")
  mkdir -p "${dir}/scripts/__lib" "${dir}/config/systemd" "${dir}/bin" "${dir}/home"
  cp "${CERT_TIMER}" "${dir}/scripts/"
  cp "${REPO_ROOT}/scripts/__lib/common.sh" "${dir}/scripts/__lib/"
  cp "${REPO_ROOT}"/config/systemd/grader-cert-renew.{service,timer} "${dir}/config/systemd/"
  cp "${REPO_ROOT}/Makefile" "${dir}/Makefile"
  cp "${REPO_ROOT}/cms" "${dir}/cms"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/systemctl"
  printf '#!/bin/bash\nexit 0\n' > "${dir}/bin/loginctl"
  chmod +x "${dir}/bin/systemctl" "${dir}/bin/loginctl"
  printf '%s' "${dir}"
}

# Every invocation carries the sandbox on both PATH and HOME, so the script can
# neither reach the real systemctl/loginctl nor write to the real unit directory.
run_in() {
  local dir="$1"
  shift
  PATH="${dir}/bin:${PATH}" HOME="${dir}/home" bash "${dir}/scripts/__cert_timer.sh" "$@" 2>&1
}

echo "--apply installs both units with the placeholder resolved"
dir="$(sandbox)"
out="$(run_in "${dir}" --apply)"
status=$?
unit_dir="${dir}/home/.config/systemd/user"
if [[ "${status}" -eq 0 ]] && [[ -f "${unit_dir}/grader-cert-renew.service" ]]; then
  ok "the service is written under the sandbox HOME"
else
  no "the service is written under the sandbox HOME (status ${status}: ${out})"
fi
if [[ -f "${unit_dir}/grader-cert-renew.timer" ]]; then
  ok "the timer is written under the sandbox HOME"
else
  no "the timer is written under the sandbox HOME"
fi

echo "no unit carries the placeholder after substitution"
for unit in grader-cert-renew.service grader-cert-renew.timer; do
  if grep -qF '@CMS_DIR@' "${unit_dir}/${unit}"; then
    no "${unit} has no @CMS_DIR@ left"
  else
    ok "${unit} has no @CMS_DIR@ left"
  fi
done

echo "the checkout, not ~/cms, is what the unit points at"
# WHY only the service carries the path: the timer is a schedule and names no
# file, so it has nothing to resolve. Asserting the checkout on both would assert
# something about the timer's contents that it should never have had.
if grep -qF "${dir}" "${unit_dir}/grader-cert-renew.service" \
   && ! grep -qF '/home/cms' "${unit_dir}/grader-cert-renew.service"; then
  ok "the service runs __domain.sh from this checkout"
else
  no "the service runs __domain.sh from this checkout"
fi
if grep -qF "${dir}/scripts/__domain.sh" "${unit_dir}/grader-cert-renew.service"; then
  ok "the ExecStart path resolves from the checkout root"
else
  no "the ExecStart path resolves from the checkout root"
fi

echo "the run names what it wrote"
for unit in grader-cert-renew.service grader-cert-renew.timer; do
  if grep -qF "${unit_dir}/${unit}" <<<"${out}"; then
    ok "output names ${unit}"
  else
    no "output names ${unit} (got: ${out})"
  fi
done

echo "a dry run writes nothing and hands over the commands"
dir="$(sandbox)"
out="$(run_in "${dir}")"
status=$?
if [[ "${status}" -eq 0 ]]; then
  ok "the default run exits 0"
else
  no "the default run exits 0 (status ${status}: ${out})"
fi
if [[ -d "${dir}/home/.config" ]]; then
  no "the default run creates no unit directory"
else
  ok "the default run creates no unit directory"
fi
if grep -qF 'systemctl --user enable --now grader-cert-renew.timer' <<<"${out}" \
   && grep -qF 'loginctl enable-linger' <<<"${out}"; then
  ok "the default run prints the enable and linger commands"
else
  no "the default run prints the enable and linger commands (got: ${out})"
fi

# WHY both cases below capture instead of piping into grep: the script exits
# non-zero on the very refusal being asserted, and under pipefail that status
# would decide the `if` instead of the message.
echo "an unknown option is refused rather than ignored"
dir="$(sandbox)"
if grep -q 'unknown option: --nope' <<<"$(run_in "${dir}" --nope)"; then
  ok "--nope is refused"
else
  no "--nope is refused"
fi

echo "a host without systemd is refused before any unit is written"
# WHY PATH is reduced to the sandbox bin rather than the stub just being deleted: the
# host's own systemctl sits later on the inherited PATH, and `command -v systemctl`
# would keep finding it. Linking only the utilities the script actually shells out to
# makes "systemd is absent" true for the run, which is the condition under test.
# Before the guard was hoisted out of apply_units this run exited non-zero holding two
# orphaned unit files and nothing enabled.
dir="$(sandbox)"
rm -f "${dir}/bin/systemctl"
for tool in bash dirname grep mkdir mktemp mv rm id; do
  ln -s "$(command -v "${tool}")" "${dir}/bin/${tool}"
done
out="$(PATH="${dir}/bin" HOME="${dir}/home" "${dir}/bin/bash" "${dir}/scripts/__cert_timer.sh" --apply 2>&1)"
status=$?
if [[ "${status}" -ne 0 ]] && grep -q 'systemctl not found' <<<"${out}"; then
  ok "the missing systemctl is named and the run exits non-zero"
else
  no "the missing systemctl is named and the run exits non-zero (status ${status}: ${out})"
fi
if [[ -d "${dir}/home/.config/systemd/user" ]]; then
  no "no unit directory is created on a host without systemd"
else
  ok "no unit directory is created on a host without systemd"
fi

echo "a missing source unit stops the install instead of writing half a pair"
dir="$(sandbox)"
rm -f "${dir}/config/systemd/grader-cert-renew.timer"
out="$(run_in "${dir}" --apply)"
status=$?
unit_dir="${dir}/home/.config/systemd/user"
if [[ "${status}" -ne 0 ]] && grep -q 'missing source unit' <<<"${out}"; then
  ok "the missing timer is named and the run exits non-zero"
else
  no "the missing timer is named and the run exits non-zero (status ${status}: ${out})"
fi
# The name in the message was never the claim under test; writing nothing was. Before
# the temp-file install the first unit was already in place when the second was refused.
for unit in grader-cert-renew.service grader-cert-renew.timer; do
  if [[ -e "${unit_dir}/${unit}" ]]; then
    no "no unit survives a refused install (${unit} was written)"
  else
    ok "no unit survives a refused install (${unit})"
  fi
done
if [[ -n "$(find "${dir}/home" -name '.grader-cert-renew.*' 2>/dev/null)" ]]; then
  no "the refused install left no temp file behind"
else
  ok "the refused install left no temp file behind"
fi

echo "a checkout path a unit could not read literally is refused"
# WHY these five characters: `'` closes the quoted ExecStart command, `$` and `\` reach
# the shell that `bash -c` hands the path to, `%` is a systemd specifier in
# WorkingDirectory=, and a newline ends the directive. Each one changes what the timer
# runs without failing at install time.
for bad_char in "'" '%' '$' '\' $'\n'; do
  dir="$(sandbox)"
  unsafe="${dir}we${bad_char}ird"
  mv "${dir}" "${unsafe}"
  SANDBOXES=("${SANDBOXES[@]:0:${#SANDBOXES[@]}-1}" "${unsafe}")
  out="$(run_in "${unsafe}" --apply)"
  status=$?
  if [[ "${status}" -ne 0 ]] && grep -q 'would not read literally' <<<"${out}"; then
    ok "a path carrying $(printf '%q' "${bad_char}") is refused"
  else
    no "a path carrying $(printf '%q' "${bad_char}") is refused (status ${status}: ${out})"
  fi
  if [[ -d "${unsafe}/home/.config/systemd/user" ]]; then
    no "a refused path wrote no unit directory"
  else
    ok "a refused path wrote no unit directory"
  fi
done

# WHY the argv path is asserted against the CLI source rather than by running ./cms:
# ./cms execs the vendored binary under .tools/, which is only rebuilt as its own step,
# so a run here would exercise a stale build. Reading the CLI's own resolve module keeps
# this suite honest about the code that ships.
RESOLVE_RS="${REPO_ROOT}/tools/cms-tui/src/cli/resolve.rs"
echo "the CLI intercepts --install-timer instead of forwarding it"
if grep -q 'DispatchKey::DomainCertTimerInstall' "${RESOLVE_RS}"; then
  ok "resolve.rs dispatches the timer install"
else
  no "resolve.rs dispatches the timer install"
fi
# WHY the check is for an option and not the bare string: the CLI intercepts
# --install-timer and never forwards it, so the script must not grow a case arm or an
# argv pass-through for it — `__domain.sh` would die on `unknown option`. The status
# output may still NAME the flag, because that is the command an operator has to type,
# and this repo's own docs print it. Matching the bare string instead would force the
# warning to stop telling the operator how to fix the thing it is warning about.
if grep -qE -- '(^|[[:space:]])--install-timer\)' "${REPO_ROOT}/scripts/__domain.sh"; then
  no "__domain.sh has no --install-timer option"
elif grep -qE -- '--install-timer[[:space:]]*\)' "${REPO_ROOT}/scripts/__domain.sh"; then
  no "__domain.sh has no --install-timer option"
else
  ok "__domain.sh still has no --install-timer option"
fi

# WHY proxy is checked here and not left to the Rust suite alone: the refusal is a clap
# payload decision, so it has to be visible in the same place the rest of this suite
# reads the CLI. `Proxy` carrying its own args type is what makes clap reject the flag.
CLI_MOD_RS="${REPO_ROOT}/tools/cms-tui/src/cli/mod.rs"
if grep -q 'Proxy(Box<DomainProxyArgs>)' "${CLI_MOD_RS}"; then
  ok "proxy carries a payload without the timer flag"
else
  no "proxy carries a payload without the timer flag"
fi
if grep -q 'DomainCmd::Cert(args) => args.timer.install_timer' "${RESOLVE_RS}"; then
  ok "cert --install-timer routes to the timer install"
else
  no "cert --install-timer routes to the timer install"
fi

echo "the timer unit name is written once"
if [[ "$(grep -c "grader-cert-renew.timer'" "${CERT_TIMER}")" -eq 1 ]]; then
  ok "the timer unit name appears exactly once in the script"
else
  no "the timer unit name appears exactly once in the script"
fi

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
(( fail == 0 ))