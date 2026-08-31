#!/usr/bin/env bash
# scripts/__tui/__smoke-p1.sh — P1 smoke proof for __engine.sh.
# Must run under a real pty of at least 80x24; exits nonzero otherwise.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=__engine.sh
source "$HERE/__engine.sh"

if ! tui::init; then
	echo "SMOKE FAIL: tui::init rejected environment (need interactive tty >= ${TUI_MIN_COLS}x${TUI_MIN_ROWS})" >&2
	exit 1
fi

echo "GUM_BIN=$GUM_BIN"
echo "THEME accent=$TUI_ACCENT fg=$TUI_FG bg=$TUI_BG dim=$TUI_DIM ok=$TUI_OK err=$TUI_ERR warn=$TUI_WARN"

tui::header "CMS Control — P1 Engine Smoke"

TSV="$(mktemp)"
trap 'rm -f "$TSV"' EXIT
printf 'SERVICE\tSTATE\tHEALTH\ndocker\tACTIVE\tOK\nnginx\tIDLE\tWARN\n' >"$TSV"
tui::table -p -f "$TSV"

tui::panel "Engine" "gum: $TUI_GUM_VERSION" "mode: tui"

tui::audit smoke "engine-ok gum=$TUI_GUM_VERSION"
AUDIT_LOG="${CMS_TUI_LOG:-${HOME}/.local/state/cms/tui.log}"
echo "AUDIT_LAST=$(tail -n 1 "$AUDIT_LOG")"

if tui::confirm "Proceed with P1 confirmation?"; then
	echo "CONFIRM=yes"
else
	echo "CONFIRM=no"
fi

echo "SPIN_RC=$(tui::spin "thinking" -- true >/dev/null 2>&1; echo $? )"
echo "SMOKE PASS"
exit 0
