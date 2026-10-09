#!/usr/bin/env bash
# scripts/__cert_timer.sh — install this checkout's certificate-renewal timer.
#
# WHY this exists instead of a line in src/install.py: the units in
# config/systemd/ ship with an unsubstituted @CMS_DIR@ placeholder, and the only
# other substituter is the upstream cms Python installer — which targets ~/cms, a
# directory this fork does not have, and is never asked for its `systemd` verb
# here (the image runs only `install.py venv` and `install.py cms`). A unit
# carrying the placeholder literally cannot be installed, so the timer never
# fired and a certificate could expire on a schedule that reported nothing due.
#
# Usage:
#   __cert_timer.sh            dry-run — print the plan, write nothing (default)
#   __cert_timer.sh --apply    write the units, reload systemd, enable the timer
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=__lib/common.sh
source "${SCRIPT_DIR}/__lib/common.sh"

DRY_RUN=1
readonly PLACEHOLDER='@CMS_DIR@'
readonly TIMER_UNIT='grader-cert-renew.timer'
readonly UNITS=('grader-cert-renew.service' 'grader-cert-renew.timer')

usage() {
  printf 'usage: %s [--dry-run|--apply]\n' "${0##*/}"
  printf '  --dry-run  print the plan and write nothing (default)\n'
  printf '  --apply    write the units, reload systemd, enable the timer\n'
}

# WHY walking up instead of taking the parent of scripts/: the script is also
# reached through a copy (a test sandbox, a bind-mounted checkout), and the one
# directory every copy agrees on is the root holding both the Makefile and ./cms.
# WHY not $PWD: a run from any other directory would then install units pointing
# at that directory instead of at the checkout the units themselves live in.
repo_root() {
  local dir="${SCRIPT_DIR}"
  while [[ "${dir}" != '/' ]]; do
    if [[ -f "${dir}/Makefile" && -x "${dir}/cms" ]]; then
      printf '%s' "${dir}"
      return 0
    fi
    dir="$(dirname -- "${dir}")"
  done
  log_die "no ancestor of ${SCRIPT_DIR} holds both Makefile and cms — run this from a CMS checkout"
}

# render_unit <source_unit> <dest> <checkout>
# WHY line-by-line rather than sed: a checkout path may carry the delimiter or a
# backreference character, and this form substitutes it as a literal without
# asking anyone to escape it.
# WHY the `|| [[ -n "${line}" ]]` tail: a unit whose last line carries no newline
# would otherwise lose that line entirely.
render_unit() {
  local source_unit="$1" dest="$2" checkout="$3" line
  : > "${dest}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    printf '%s\n' "${line//"${PLACEHOLDER}"/${checkout}}" >> "${dest}"
  done < "${source_unit}"
}

install_units() {
  local repo="$1" dest_dir="$2" unit source_unit dest
  for unit in "${UNITS[@]}"; do
    source_unit="${repo}/config/systemd/${unit}"
    [[ -f "${source_unit}" ]] || log_die "missing source unit: ${source_unit}"
    dest="${dest_dir}/${unit}"
    if [[ "${DRY_RUN}" -eq 1 ]]; then
      log_info "would write ${dest}"
      continue
    fi
    mkdir -p "${dest_dir}"
    render_unit "${source_unit}" "${dest}" "${repo}"
    # WHY re-reading the file rather than trusting the substitution: a unit whose
    # placeholder sits somewhere this pass does not reach installs as a unit
    # systemd refuses to parse, which fails far from this script.
    if grep -q "${PLACEHOLDER}" "${dest}"; then
      log_die "${dest} still carries ${PLACEHOLDER} after substitution"
    fi
    log_info "wrote ${dest}"
  done
}

apply_units() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log_info "would run: systemctl --user daemon-reload"
    log_info "would run: systemctl --user enable --now ${TIMER_UNIT}"
    log_info "would run: loginctl enable-linger $(id -un)"
    return 0
  fi

  command -v systemctl >/dev/null 2>&1 \
    || log_die "systemctl not found — these are systemd user units and cannot be installed without it"
  systemctl --user daemon-reload
  systemctl --user enable --now "${TIMER_UNIT}"

  # WHY non-fatal: lingering is what keeps a user timer alive with no login
  # session, but it needs authority this process may not hold. Failing the whole
  # install over it would discard units that already work for a logged-in
  # operator, so the gap is named and the command that closes it is printed.
  if ! loginctl enable-linger "$(id -un)" 2>/dev/null; then
    log_warn "could not enable lingering for $(id -un) — the timer will not fire outside a login session unless an operator runs:"
    log_warn "  loginctl enable-linger $(id -un)"
  fi

  log_info "certificate renewal is scheduled; check it with: systemctl --user list-timers ${TIMER_UNIT}"
}

main() {
  local repo dest_dir
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1; shift ;;
      --apply)   DRY_RUN=0; shift ;;
      -h|--help) usage; return 0 ;;
      *)         log_die "unknown option: $1" 2 ;;
    esac
  done

  repo="$(repo_root)"
  dest_dir="${HOME}/.config/systemd/user"

  log_info "Cert renewal timer install — mode: $([ "${DRY_RUN}" -eq 1 ] && echo 'DRY-RUN' || echo 'APPLY')"
  log_info "checkout: ${repo}"
  log_info "units destination: ${dest_dir}"
  install_units "${repo}" "${dest_dir}"
  apply_units
}

main "$@"