#!/usr/bin/env bash
# scripts/__tui/runners/__stacks.sh — stack chooser for deploy/stop/clean/pull.
#
# Make invocations mirror ./cms dispatch byte-for-byte:
#   deploy N          -> make N            (--img adds DEPLOYMENT_TYPE_OVERRIDE=img)
#   deploy all        -> loop core infra admin contest worker
#   stop N / stop all -> make N-stop / loop core admin contest worker infra
#   clean N / all     -> make N-clean / make clean
#   pull N / pull all -> make pull-N / make pull
# Long makes stream straight to the terminal after confirmation (no capture).

_STACKS_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=../__engine.sh
source "$_STACKS_TUI_DIR/__engine.sh"

STACKS_DEPLOY_ORDER=(core infra admin contest worker)
STACKS_STOP_ORDER=(core admin contest worker infra)
STACKS_CMDS=()
STACKS_DESC=''

stacks::_validate() {
	local action="$1" stack="$2"
	case "$action" in deploy|stop|clean|pull) ;; *) return 2 ;; esac
	case "$stack" in core|admin|contest|worker|infra|all) ;; *) return 2 ;; esac
}

# Fill STACKS_CMDS / STACKS_DESC for action+stack(+img), mirroring cms cases.
stacks::_plan() {
	local action="$1" stack="$2" img="$3" s prefix=''
	[[ -n "$img" ]] && prefix='DEPLOYMENT_TYPE_OVERRIDE=img'
	STACKS_CMDS=()
	STACKS_DESC="$action $stack${img:+ (--img)}"
	case "$action" in
		deploy)
			if [[ "$stack" == "all" ]]; then
				for s in "${STACKS_DEPLOY_ORDER[@]}"; do STACKS_CMDS+=("${prefix:+$prefix }make $s"); done
			else
				STACKS_CMDS+=("${prefix:+$prefix }make $stack")
			fi ;;
		stop)
			if [[ "$stack" == "all" ]]; then
				for s in "${STACKS_STOP_ORDER[@]}"; do STACKS_CMDS+=("make ${s}-stop"); done
			else
				STACKS_CMDS+=("make ${stack}-stop")
			fi ;;
		clean)
			if [[ "$stack" == "all" ]]; then STACKS_CMDS+=("make clean")
			else STACKS_CMDS+=("make ${stack}-clean"); fi ;;
		pull)
			if [[ "$stack" == "all" ]]; then STACKS_CMDS+=("make pull")
			else STACKS_CMDS+=("make pull-${stack}"); fi ;;
	esac
}

stacks::_execute() {
	local cmd rc=0
	for cmd in ${STACKS_CMDS[@]+"${STACKS_CMDS[@]}"}; do
		bash -c "$cmd" || rc=1
	done
	if (( rc == 0 )); then
		printf '\n[OK] %s\n' "$STACKS_DESC"
	else
		printf '\n[FAILED] %s (exit %d)\n' "$STACKS_DESC" "$rc"
	fi
	tui::audit "stacks:$STACKS_DESC" "rc=$rc"
	return "$rc"
}

# Entry: optional preset action/stack/img (from explicit cms args); anything
# missing is asked interactively.
stacks::run() {
	local action="${1:-}" stack="${2:-}" img="${3:-}"
	tui::_need_gum || return $?
	if [[ -z "$action" ]]; then
		action="$(tui::choose "Stacks — pick an action" deploy stop clean pull)" || return 1
	fi
	if [[ -z "$stack" ]]; then
		stack="$(tui::choose "Action '$action' — pick a stack" \
			core admin contest worker infra all)" || return 1
	fi
	if [[ "$action" == "deploy" && -z "$img" ]] && tui::confirm "Rebuild images too (--img)?"; then
		img=1
	fi
	stacks::_validate "$action" "$stack" || { printf 'unknown stack/action: %s %s\n' "$action" "$stack" >&2; return 2; }
	stacks::_plan "$action" "$stack" "$img" || return $?
	tui::confirm "Execute: $STACKS_DESC ?" || { tui::audit "declined:stacks" "$STACKS_DESC"; return 1; }
	tui::audit "stacks:start" "$STACKS_DESC"
	stacks::_execute
}
