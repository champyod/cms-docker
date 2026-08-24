#!/usr/bin/env bash
# scripts/__tui/runners/fleet.sh — entrypoint adapter for `cms worker edit|tui`.
#
# Bridges the cms dispatch table to the P3 fleet module
# (scripts/__tui/fleet.sh): initializes the engine, delegates to fleet::main,
# and falls back to the legacy standalone fleet TUI when the terminal cannot
# support the gum engine.

_FLEET_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
_FLEET_MODULE="$_FLEET_TUI_DIR/fleet.sh"
_FLEET_LEGACY="$_FLEET_TUI_DIR/../../scripts/__worker_tui.sh"

# shellcheck source=../engine.sh
source "$_FLEET_TUI_DIR/engine.sh"

if ! tui::init; then
	exec bash "$_FLEET_LEGACY" "$@"
fi

# shellcheck source=../fleet.sh
source "$_FLEET_MODULE"

fleet::main "$@"
exit $?
