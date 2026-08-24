#!/usr/bin/env bash
# scripts/__tui/menus/tailscale.sh — tailscale serve menu: status panel plus
# setup/remove actions behind confirmation. Requires an initialized engine.

_TS_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
_TS_SCRIPTS="$(cd -- "$_TS_TUI_DIR/../.." && pwd -P)/scripts"
# shellcheck source=../engine.sh
source "$_TS_TUI_DIR/engine.sh"
# shellcheck source=../runners/simple.sh
source "$_TS_TUI_DIR/runners/simple.sh"

TAILSCALE_MENU_MAX_LINES="${TAILSCALE_MENU_MAX_LINES:-20}"

# Render `__tailscale_serve.sh status` output inside a panel (capped tail).
tailscale_menu::status() {
	local out rc=0 lines=()
	out="$(bash "$_TS_SCRIPTS/__tailscale_serve.sh" status 2>&1)" || rc=$?
	mapfile -t lines <<<"$(printf '%s' "${out:-<no output>}" | tail -n "$TAILSCALE_MENU_MAX_LINES")"
	tui::panel "tailscale serve status (exit $rc)" ${lines[@]+"${lines[@]}"}
	return 0
}

tailscale_menu::show() {
	local script
	printf -v script '%q' "$_TS_SCRIPTS/__tailscale_serve.sh"
	tui::header "Tailscale Serve"
	tailscale_menu::status
	local act
	act="$(tui::choose "Tailscale action" setup remove back)" || return 0
	case "$act" in
		back) return 0 ;;
		setup|remove)
			simple::run "tailscale $act" "bash $script $act" ;;
	esac
}
