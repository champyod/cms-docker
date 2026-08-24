#!/usr/bin/env bash
# scripts/__tui/menus/update-server.sh — guarded wrapper around the
# shard-aware server update flow (__update-server.sh), streamed directly.

_US_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
_US_SCRIPTS="$(cd -- "$_US_TUI_DIR/../.." && pwd -P)/scripts"
# shellcheck source=../engine.sh
source "$_US_TUI_DIR/engine.sh"

update_server_menu::run() {
	local desc="Shard-aware server update"
	tui::header "Update Server"
	tui::panel "update-server" \
		"Pulls latest code + submodules, refreshes images," \
		"and restarts stacks shard-aware." ""
	if ! tui::confirm "Run server update now?"; then
		tui::audit "declined:update-server" ''
		return 1
	fi
	tui::audit "update-server:start" ''
	bash "$_US_SCRIPTS/__update-server.sh" "$@"
	local rc=$?
	if (( rc == 0 )); then
		printf '\n[OK] %s\n' "$desc"
	else
		printf '\n[FAILED] %s (exit %d)\n' "$desc" "$rc"
	fi
	local args_detail=''
	[[ $# -gt 0 ]] && args_detail="args=$(printf '%q ' "$@")"
	tui::audit "update-server" "rc=$rc $args_detail"
	return "$rc"
}
