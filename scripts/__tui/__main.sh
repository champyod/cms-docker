#!/usr/bin/env bash
# scripts/__tui/__main.sh — TTY-gated router for interactive `cms <command>`.
#
# Invoked by ./cms only when stdin+stdout are TTYs, CMS_NO_TUI is unset, and
# no incompatible form was given (--workers-json, drill). Undersized terminals
# or a missing gum binary fall back to the plain cms handlers.

set -uo pipefail

_MAIN_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
_MAIN_CMS_ROOT="$(cd -- "$_MAIN_TUI_DIR/../.." && pwd -P)"
_MAIN_SCRIPTS="$_MAIN_CMS_ROOT/scripts"

# Bare invocation goes straight to the dashboard module (own engine init and
# alt-screen lifecycle); command routing continues below.
if [[ $# -eq 0 ]]; then
	exec bash "$_MAIN_TUI_DIR/__dashboard.sh"
fi

ORIG_ARGS=("$@")

# shellcheck source=__engine.sh
source "$_MAIN_TUI_DIR/__engine.sh"
# shellcheck source=runners/__simple.sh
source "$_MAIN_TUI_DIR/runners/__simple.sh"
# shellcheck source=runners/__stacks.sh
source "$_MAIN_TUI_DIR/runners/__stacks.sh"
# shellcheck source=menus/__tailscale.sh
source "$_MAIN_TUI_DIR/menus/__tailscale.sh"
# shellcheck source=menus/__funnel.sh
source "$_MAIN_TUI_DIR/menus/__funnel.sh"
# shellcheck source=menus/__update-server.sh
source "$_MAIN_TUI_DIR/menus/__update-server.sh"

if ! tui::init; then
	CMS_NO_TUI=1 exec bash "$_MAIN_CMS_ROOT/cms" "${ORIG_ARGS[@]}"
fi

# Build a safely quoted "bash <script> [args...]" string for simple::run.
main::_script_cmd() {
	local script="$1" q argq
	shift
	printf -v q '%q' "$script"
	for arg in "$@"; do
		printf -v argq '%q' "$arg"
		q+=" $argq"
	done
	printf '%s' "$q"
}

# Snapshot of service status rendered inside a bordered panel.
main::status_view() {
	local out rc=0 body
	out="$(bash "$_MAIN_SCRIPTS/__status.sh" 2>&1)" || rc=$?
	body="$(printf '%s\n' "$out" | tail -n "${MAIN_STATUS_MAX_LINES:-60}")"
	tui::header "CMS Services Status"
	tui::gum style --border rounded --border-foreground "$TUI_DIM" \
		--padding '1 2' -- "$body" || printf '%s\n' "$body"
	tui::audit "view:status" "rc=$rc"
	return 0
}

# Confirm, run a helper script with streamed output, print a result line.
main::confirm_exec() {
	local desc="$1" script="$2" rc=0
	shift 2
	if ! tui::confirm "$desc ?"; then
		tui::audit "declined:$desc" ''
		return 1
	fi
	bash "$script" "$@" || rc=$?
	if (( rc == 0 )); then
		printf '\n[OK] %s\n' "$desc"
	else
		printf '\n[FAILED] %s (exit %d)\n' "$desc" "$rc"
	fi
	local args_detail=''
	[[ $# -gt 0 ]] && args_detail="args=$(printf '%q ' "$@")"
	tui::audit "$desc" "rc=$rc $args_detail"
	return "$rc"
}

main::db_menu() {
	local sub target
	sub="$(tui::choose "Database operation (make target)" init reset clean sync back)" || return 0
	case "$sub" in
		back) return 0 ;;
		init) target=cms-init ;;
		reset) target=db-reset ;;
		clean) target=db-clean ;;
		sync) target=prisma-sync ;;
	esac
	simple::run "db $sub (make $target)" "make $target"
}

main::_contest_create() {
	if [[ "${1:-}" != "create" ]]; then
		echo "usage: cms contest create <yaml...>" >&2
		exit 2
	fi
	shift
	main::confirm_exec "Create contests from YAML" "$_MAIN_SCRIPTS/__create_contests.sh" "$@"
}

# Split optional deploy args into stack name plus --img flag.
main::_parse_deploy() {
	local arg
	stack=''
	img=''
	for arg in "$@"; do
		if [[ "$arg" == "--img" ]]; then img=1; else stack="$arg"; fi
	done
}

main::route() {
	local cmd="$1" stack='' img=''
	shift
	case "$cmd" in
		status) main::status_view ;;
		monitor) exec bash "$_MAIN_SCRIPTS/__monitor.sh" "$@" ;;
		backup) simple::run "Backup now (make backup)" "make backup" ;;
		restore) simple::run "Restore from archive" "$(main::_script_cmd "$_MAIN_SCRIPTS/__restore.sh" "$@")" ;;
		doctor) simple::run "Preflight environment checks" "$(main::_script_cmd "$_MAIN_SCRIPTS/__preflight.sh")" ;;
		test) simple::run "Smoke test" "$(main::_script_cmd "$_MAIN_SCRIPTS/__smoke-test.sh" "$@")" ;;
		db) main::db_menu ;;
		admin-create) simple::run "Create superadmin (make admin-create)" "make admin-create" ;;
		contest) main::_contest_create "$@" ;;
		deploy)
			main::_parse_deploy "$@"
			stacks::run deploy "$stack" "$img"
			;;
		stop|clean) stacks::run "$cmd" "${1:-}" '' ;;
		pull) stacks::run pull "${1:-}" '' ;;
		tailscale) tailscale_menu::show ;;
		funnel) funnel_menu::show ;;
		update-server) update_server_menu::run "$@" ;;
		expose) exec bash "$_MAIN_SCRIPTS/__tui/wizards/__expose.sh" ;;
		domain) exec bash "$_MAIN_SCRIPTS/__domain.sh" "$@" ;;
		*) CMS_NO_TUI=1 exec bash "$_MAIN_CMS_ROOT/cms" "${ORIG_ARGS[@]}" ;;
	esac
}

main::route "$@"
exit $?
