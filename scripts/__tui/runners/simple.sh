#!/usr/bin/env bash
# scripts/__tui/runners/simple.sh — reusable confirm/spin/result command adapter.
#
# Contract:
#   * Callers must have run tui::init successfully; primitives return 127
#     otherwise (engine contract).
#   * simple::run captures command output and reports through a result panel;
#     use it for short/medium operations.
#   * simple::run_list streams snippets straight to the terminal; use it for
#     long builds where live progress matters (e.g. make).
#
# Exports:
#   simple::run TITLE COMMAND
#   simple::run_list DESC CMD [CMD...]

_SIMPLE_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=../engine.sh
source "$_SIMPLE_TUI_DIR/engine.sh"

SIMPLE_TAIL_LINES="${SIMPLE_TAIL_LINES:-15}"

# Result panel: exit code plus the tail of the captured output.
simple::_result_panel() {
	local title="$1" rc="$2" out_file="$3" status tail
	if (( rc == 0 )); then status="OK"; else status="FAILED"; fi
	tail="$(tail -n "$SIMPLE_TAIL_LINES" -- "$out_file" 2>/dev/null || true)"
	local lines=()
	[[ -n "$tail" ]] && mapfile -t lines <<<"$tail"
	tui::panel "$title — $status" "exit code: $rc" ${lines[@]+"${lines[@]}"}
}

# Confirm, run COMMAND under a spinner with output captured to a temp file,
# show a result panel (tail + exit status), audit the action.
# Returns the command's exit code; returns 1 when the user declines.
simple::run() {
	local title="${1:?usage: simple::run TITLE COMMAND}"
	local cmd="${2:?usage: simple::run TITLE COMMAND}"
	tui::_need_gum || return $?
	tui::confirm "Run: $title ?" || { tui::audit "declined:$title" ''; return 1; }
	local out_file rc=0
	out_file="$(mktemp "${TMPDIR:-/tmp}/cms-tui-simple.XXXXXX")" || return 1
	tui::spin "Running: $title" -- bash -c "$cmd" >"$out_file" 2>&1 || rc=$?
	simple::_result_panel "$title" "$rc" "$out_file"
	rm -f -- "$out_file"
	tui::audit "run:$title" "rc=$rc cmd=$cmd"
	return "$rc"
}

# Stream shell snippet(s) directly to the terminal, then print one result
# line. Aggregated exit code follows cms semantics (any failure -> nonzero).
simple::run_list() {
	local desc="${1:?usage: simple::run_list DESC CMD...}"
	shift
	local cmd rc=0
	for cmd in "$@"; do
		printf '\n==> %s\n' "$cmd"
		bash -c "$cmd" || rc=1
	done
	if (( rc == 0 )); then
		printf '\n[OK] %s\n' "$desc"
	else
		printf '\n[FAILED] %s (exit %d)\n' "$desc" "$rc"
	fi
	return "$rc"
}
