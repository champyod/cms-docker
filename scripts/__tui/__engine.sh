#!/usr/bin/env bash
# scripts/__tui/__engine.sh — shared engine for the CMS gum-based TUI.
#
# Usage (from any script):
#   source scripts/__tui/__engine.sh
#   if tui::init; then ... tui::choose "Pick" a b c ...
#   else             tui::plain; <legacy plain-CLI path>; fi
#
# Contract:
#   * Source-safe and idempotent — top level defines functions and lazy
#     defaults only; no execution side effects.
#   * Does not enable set -e/-u/-o pipefail; safe under callers that do,
#     provided interactive primitives are consumed inside if/|| guards
#     (their exit codes are meaningful).
#   * Interactive primitives (choose/filter/confirm/spin/gum) require a
#     successful tui::init and return 127 otherwise.
#   * Decorative primitives (header/panel/table) degrade to plain output
#     when the engine is not initialized.
#   * External deps: vendored gum binary + coreutils only.

TUI_GUM_VERSION="0.14.5"
TUI_MIN_COLS=80
TUI_MIN_ROWS=24

# Theme palette (256-color codes). Defaults apply when ~/.config/cms/theme
# is absent or missing keys; user values survive re-sourcing.
: "${TUI_ACCENT:=196}"
: "${TUI_FG:=252}"
: "${TUI_BG:=235}"
: "${TUI_DIM:=244}"
: "${TUI_OK:=114}"
: "${TUI_ERR:=203}"
: "${TUI_WARN:=214}"

# Reusable gate: 0 only when stdin+stdout are a TTY and the terminal is at
# least ${TUI_MIN_COLS}x${TUI_MIN_ROWS}. Silent; callers own messaging.
tui::guard() {
	[[ -t 0 && -t 1 ]] || return 1
	local info='' rows='' cols=''
	if info="$(stty size </dev/tty 2>/dev/null)"; then
		rows="${info%% *}"
		cols="${info#* }"
	else
		rows="${LINES:-0}"
		cols="${COLUMNS:-0}"
	fi
	[[ $rows =~ ^[0-9]+$ && $cols =~ ^[0-9]+$ ]] || return 1
	(( cols >= TUI_MIN_COLS && rows >= TUI_MIN_ROWS ))
}

# Plain-mode marker: call in the legacy fallback branch after init failure.
# Clears readiness so accidental primitive calls take their plain path.
tui::plain() {
	TUI_READY=''
	TUI_PLAIN=1
}

# Master gate for callers: 0 iff the engine is initialized and usable.
tui::tty_ok() {
	[[ -n "${TUI_READY:-}" ]]
}

# Load KEY=VALUE theme file (comments/blanks ignored). Unknown keys and
# non-token values are skipped silently so a bad line cannot break init.
tui::_load_theme() {
	local theme_file="${CMS_TUI_THEME:-${HOME}/.config/cms/theme}"
	local line key val
	[[ -r "$theme_file" ]] || return 0
	while IFS='=' read -r key val || [[ -n "$key" ]]; do
		key="${key#"${key%%[![:space:]]*}"}"
		key="${key%"${key##*[![:space:]]}"}"
		val="${val%$'\r'}"
		val="${val//[[:space:]]/}"
		[[ $key =~ ^[a-z]+$ && $val =~ ^[A-Za-z0-9]+$ ]] || continue
		case "$key" in
			accent) TUI_ACCENT="$val" ;;
			fg)     TUI_FG="$val" ;;
			bg)     TUI_BG="$val" ;;
			dim)    TUI_DIM="$val" ;;
			ok)     TUI_OK="$val" ;;
			err)    TUI_ERR="$val" ;;
			warn)   TUI_WARN="$val" ;;
		esac
	done <"$theme_file"
}

# Resolve gum binary, enforce environment gates, load theme.
# Returns nonzero (clean stderr message on binary problems) when the caller
# must fall back to its plain CLI path.
tui::init() {
	TUI_READY=''
	tui::guard || return 1
	local arch dir
	case "$(uname -m)" in
		x86_64|amd64)   arch="x86_64" ;;
		aarch64|arm64)  arch="arm64" ;;
		*)
			printf 'tui: unsupported architecture: %s\n' "$(uname -m)" >&2
			return 1
			;;
	esac
	dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)" || return 1
	GUM_BIN="${dir}/../../.tools/gum/${TUI_GUM_VERSION}/gum-linux-${arch}"
	if [[ ! -f "$GUM_BIN" || ! -x "$GUM_BIN" ]]; then
		printf 'tui: gum binary missing or not executable: %s\n' "$GUM_BIN" >&2
		return 1
	fi
	tui::_load_theme
	TUI_READY=1
	return 0
}

# Internal readiness check for primitives that cannot degrade.
tui::_need_gum() {
	tui::tty_ok && [[ -n "${GUM_BIN:-}" && -x "$GUM_BIN" ]] && return 0
	printf 'tui: engine not initialized; "%s" requires a successful tui::init\n' \
		"${FUNCNAME[1]:-?}" >&2
	return 127
}

# Thin passthrough to the vendored gum binary. Exit status propagates.
tui::gum() {
	tui::_need_gum || return $?
	"$GUM_BIN" "$@"
}

# Bold accent banner. Degrades to a plain rule when uninitialized.
tui::header() {
	local title="${1:?usage: tui::header TITLE}"
	if ! tui::tty_ok; then
		printf '=== %s ===\n' "$title"
		return 0
	fi
	"$GUM_BIN" style --bold --border rounded \
		--foreground "$TUI_ACCENT" --border-foreground "$TUI_ACCENT" \
		--padding '0 1' --align center --width 40 -- "$title"
}

# Render TSV from stdin (or gum table flags, e.g. -f FILE) as a table.
# Passthrough when uninitialized.
tui::table() {
	if ! tui::tty_ok; then
		cat
		return 0
	fi
	"$GUM_BIN" table --border rounded \
		--border.foreground "$TUI_ACCENT" --header.foreground "$TUI_ACCENT" \
		"$@"
}

# Prompt line shared by choose/filter/confirm.
tui::_prompt() {
	local prompt="${1:?usage: prompt PROMPT}"
	"$GUM_BIN" style --foreground "$TUI_DIM" --bold -- "$prompt"
}

# tui::choose "prompt" item... → selected item on stdout.
tui::choose() {
	local prompt="${1:?usage: tui::choose PROMPT ITEM...}"; shift
	tui::_need_gum || return $?
	tui::_prompt "$prompt"
	"$GUM_BIN" choose --cursor.foreground "$TUI_ACCENT" \
		--selected.foreground "$TUI_ACCENT" --header.foreground "$TUI_ACCENT" \
		--header "" -- "$@"
}

# tui::choose_multi "prompt" item... → space-separated items on stdout.
tui::choose_multi() {
	local prompt="${1:?usage: tui::choose_multi PROMPT ITEM...}"; shift
	tui::_need_gum || return $?
	tui::_prompt "$prompt"
	"$GUM_BIN" choose --no-limit --cursor.foreground "$TUI_ACCENT" \
		--selected.foreground "$TUI_ACCENT" --header.foreground "$TUI_ACCENT" \
		--header "" -- "$@"
}

# tui::filter "prompt" item... → matched item on stdout.
tui::filter() {
	local prompt="${1:?usage: tui::filter PROMPT ITEM...}"; shift
	tui::_need_gum || return $?
	"$GUM_BIN" filter --placeholder "$prompt" \
		--indicator.foreground "$TUI_ACCENT" --match.foreground "$TUI_ACCENT" \
		--prompt.foreground "$TUI_ACCENT" -- "$@"
}

# tui::confirm "question" → exit code passthrough (0=yes, 1=no, 130=interrupt).
tui::confirm() {
	local question="${1:?usage: tui::confirm QUESTION}"
	shift
	tui::_need_gum || return $?
	tui::_prompt "$question"
	"$GUM_BIN" confirm --selected.background "$TUI_ACCENT" "$@"
}

# tui::spin "label" -- cmd... → runs cmd under spinner; cmd's exit code passes through.
tui::spin() {
	local label="${1:?usage: tui::spin LABEL -- CMD...}"; shift
	[[ ${1:-} == "--" ]] && shift
	tui::_need_gum || return $?
	"$GUM_BIN" spin --spinner dot --title "$label" \
		--title.foreground "$TUI_DIM" --spinner.foreground "$TUI_ACCENT" -- "$@"
}

# tui::panel "title" line... → bordered block with accent title line.
tui::panel() {
	local title="${1:?usage: tui::panel TITLE LINE...}"
	shift
	if ! tui::tty_ok; then
		local l
		printf '[ %s ]\n' "$title"
		for l in "$@"; do printf '  %s\n' "$l"; done
		return 0
	fi
	local body
	body="$("$GUM_BIN" style --bold --foreground "$TUI_ACCENT" -- "$title")"$'\n'"$(printf '%s\n' "$@")"
	"$GUM_BIN" style --border rounded --border-foreground "$TUI_DIM" \
		--padding '1 2' --width 40 -- "$body"
}

# Audit trail: one best-effort line per action. Never fails and never
# breaks UX; newlines in detail are flattened to keep records single-line.
tui::audit() {
	local action="${1:?usage: tui::audit ACTION DETAIL}"
	local detail="${2:-}"
	local log="${CMS_TUI_LOG:-${HOME}/.local/state/cms/tui.log}"
	action="${action//$'\n'/ }"
	detail="${detail//$'\n'/ }"
	mkdir -p -- "$(dirname -- "$log")" &&
		printf '%s | %s | %s\n' \
			"$(date '+%Y-%m-%dT%H:%M:%S%z')" "$action" "$detail" >>"$log" ||
		return 0
}
