#!/usr/bin/env bash
# The waiver table's CI entry: gate on it, render the suppressions it licenses.
#
# WHY a wrapper over the panel script: three CI jobs need the same two commands against the same
# committed export, and the export's path belongs in one place — a job that pointed at a different
# file would be reading a list nobody maintains. The wrapper also pins the working directory, so
# `bun` resolves the panel's `@/…` aliases from the panel's tsconfig.
#
# WHY the export is a committed file and not a query: CI holds no credential that can read the
# panel or its database, by design (docs/SECURITY-FEED.md §"Suppressions in CI"). Rendering
# security/waivers.json needs the panel's DATABASE_URL and is an operator/panel-side command:
#
#   (cd admin-panel && bun run scripts/security-waivers.ts export)
#
# Usage:
#   __security_waivers.sh check                     # exit 1 when a waiver is past its review date
#   __security_waivers.sh render --trivy .trivyignore
#   __security_waivers.sh render --audit-ids "$RUNNER_TEMP/waiver-audit-ids"
set -eu
if (set -o pipefail 2>/dev/null); then
  set -o pipefail
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

WAIVER_EXPORT="security/waivers.json"
PANEL_SCRIPT="admin-panel/scripts/security-waivers.ts"

mode="${1:-}"
case "$mode" in
  check|render) ;;
  *)
    log_die "usage: $0 check|render [--trivy <path>] [--audit-ids <path>]" 2
    ;;
esac
shift

if ! bun_bin="$(resolve_bun)"; then
  log_die "bun is required to read the waiver export and is not installed" 1
fi
[ -f "${REPO_ROOT}/${WAIVER_EXPORT}" ] || log_die "missing ${WAIVER_EXPORT} — render it from the panel: (cd admin-panel && bun run scripts/security-waivers.ts export)" 1
[ -f "${REPO_ROOT}/${PANEL_SCRIPT}" ] || log_die "missing ${PANEL_SCRIPT}" 1

cd "$REPO_ROOT"
exec "$bun_bin" "$PANEL_SCRIPT" "$mode" --from "$WAIVER_EXPORT" "$@"
