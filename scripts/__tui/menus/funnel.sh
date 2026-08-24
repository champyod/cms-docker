#!/usr/bin/env bash
# scripts/__tui/menus/funnel.sh — public funnel menu: status panel plus
# setup/passwd/remove actions behind confirmation. Requires initialized engine.

_FUNNEL_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
_FUNNEL_SCRIPTS="$(cd -- "$_FUNNEL_TUI_DIR/../.." && pwd -P)/scripts"
# shellcheck source=../engine.sh
source "$_FUNNEL_TUI_DIR/engine.sh"
# shellcheck source=../runners/simple.sh
source "$_FUNNEL_TUI_DIR/runners/simple.sh"

FUNNEL_MENU_MAX_LINES="${FUNNEL_MENU_MAX_LINES:-20}"

# Render `__funnel.sh status` output inside a panel (capped tail).
funnel_menu::status() {
	local out rc=0 lines=()
	out="$(bash "$_FUNNEL_SCRIPTS/__funnel.sh" status 2>&1)" || rc=$?
	mapfile -t lines <<<"$(printf '%s' "${out:-<no output>}" | tail -n "$FUNNEL_MENU_MAX_LINES")"
	tui::panel "funnel status (exit $rc)" ${lines[@]+"${lines[@]}"}
	return 0
}

funnel_menu::passwd_flow() {
	local user uq script
	user="$(tui::gum input --placeholder 'basic-auth username' --prompt '> ')" || return 1
	if [[ -z "$user" ]]; then
		tui::panel "funnel passwd" "aborted: empty username"
		return 1
	fi
	printf -v script '%q' "$_FUNNEL_SCRIPTS/__funnel.sh"
	printf -v uq '%q' "$user"
	simple::run "funnel passwd $user" "bash $script passwd $uq"
}

funnel_menu::show() {
	local script
	printf -v script '%q' "$_FUNNEL_SCRIPTS/__funnel.sh"
	tui::header "Public Funnel Access"
	funnel_menu::status
	local act
	act="$(tui::choose "Funnel action" setup passwd remove back)" || return 0
	case "$act" in
		back) return 0 ;;
		setup|remove)
			simple::run "funnel $act" "bash $script $act" ;;
		passwd)
			funnel_menu::passwd_flow ;;
	esac
}
