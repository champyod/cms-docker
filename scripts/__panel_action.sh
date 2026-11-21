#!/usr/bin/env bash
# Run one panel action in-process, with no panel server up.
#
# WHY the action runs here and not over HTTP: the operator's requirement is that a binding, a
# shown contest and an override are settable while the panel is down, so there is nothing to call
# but the write itself. The entry imports the same module the panel's server actions wrap
# (admin-panel/src/lib/panel-actions), so the script side and the panel cannot mean different
# things by the same action.
#
# Called from ./cms as `./cms panel <area> <verb> [args]`; ./cms owns the verb list, this script
# owns how an action runs.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/__lib/common.sh"

PANEL_DIR="${REPO_ROOT}/admin-panel"
PANEL_ENTRY="src/cli/main.ts"

# A bare invocation prints the verb list rather than failing with a missing-area message.
if [ "$#" -eq 0 ]; then
  set -- help
fi

if ! bun_bin="$(resolve_bun)"; then
  log_die "bun is required to run a panel action in-process and is not installed — install bun, or use the panel." 1
fi
[ -f "${PANEL_DIR}/${PANEL_ENTRY}" ] || log_die "missing panel action entry: ${PANEL_DIR}/${PANEL_ENTRY}" 1

# WHY the cwd is the panel package: bun reads the `@/…` aliases from the panel's tsconfig and
# DATABASE_URL from the panel's .env, which is the connection the panel itself dials.
cd "${PANEL_DIR}" || log_die "cannot enter ${PANEL_DIR}" 1
exec "${bun_bin}" "${PANEL_ENTRY}" "$@"
