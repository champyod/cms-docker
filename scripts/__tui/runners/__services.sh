#!/usr/bin/env bash
# scripts/__tui/runners/__services.sh — service/stack status collection + drill-downs.
# Canonical services mirror tools/cms-tui/src/ui/dashboard.rs CORE_SERVICES;
# each entry maps the canonical name to its docker-compose service name.

_SVC_TUI_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=scripts/__tui/__engine.sh
source "$_SVC_TUI_DIR/__engine.sh"
# shellcheck source=scripts/__tui/runners/__simple.sh
source "$_SVC_TUI_DIR/runners/__simple.sh"
# shellcheck source=scripts/__tui/runners/__stacks.sh
source "$_SVC_TUI_DIR/runners/__stacks.sh"

SVC_CORE_SERVICES=(
	"database|database"
	"log-service|log-service"
	"scoring|scoring-service"
	"evaluation|evaluation-service"
	"proxy|proxy-service"
	"checker|checker-service"
	"admin-panel-next|admin-panel-next"
	"ranking-web-server|ranking-web-server"
)
SVC_STACKS=(core admin contest worker infra monitor)
SVC_PS_TSV=''
SVC_NAMES=() SVC_COMPOSE=() SVC_STACK_NAMES=()

svc::collect_ps() { # -> SVC_PS_TSV: compose-name<TAB>state<TAB>health per container
	local out
	out="$(timeout 15 docker compose ps --all --format '{{.Service}}\t{{.State}}\t{{.Health}}' 2>/dev/null || true)"
	SVC_PS_TSV="$out"
}

svc::ps_lookup() { # COMPOSE_NAME -> "state|health" (absent|- when no container)
	local name="$1" line st hl
	line="$(printf '%s\n' "$SVC_PS_TSV" | awk -F'\t' -v n="$name" '$1==n {print $2"|"$3; exit}')"
	[[ -z "$line" ]] && { printf 'absent|-'; return; }
	IFS='|' read -r st hl <<<"$line"
	printf '%s|%s' "$st" "${hl:--}"
}

svc::stack_lookup() { # STACK -> "state|running/total" across the stack's containers
	local stack="$1" out st running=0 total=0
	out="$(timeout 10 docker compose --profile "$stack" ps --all --format '{{.State}}' 2>/dev/null || true)"
	[[ -z "$out" ]] && { printf 'absent|-'; return; }
	while IFS= read -r st; do
		[[ -z "$st" ]] && continue
		total=$(( total + 1 ))
		[[ "$st" == running ]] && running=$(( running + 1 ))
	done <<<"$out"
	if (( running == total )); then printf 'running|%s/%s' "$running" "$total"
	elif (( running > 0 )); then printf 'partial|%s/%s' "$running" "$total"
	else printf 'stopped|%s/%s' "$running" "$total"; fi
}

svc::collect() { # SVC_CURSOR STACK_CURSOR SVC_DETAIL -> DASH_SVC_TSV / DASH_STACK_TSV
	local svc_cursor="$1" stack_cursor="$2" detail="$3" entry name compose st hl mark i=0
	local tmp="/tmp/cms-tui-stacks-$$"
	svc::collect_ps
	SVC_NAMES=() SVC_COMPOSE=()
	if (( detail )); then DASH_SVC_TSV=$'SERVICE\tSTATE\tHEALTH\n'; else DASH_SVC_TSV=$'SERVICE\tHEALTH\n'; fi
	for entry in "${SVC_CORE_SERVICES[@]}"; do
		name="${entry%%|*}"; compose="${entry##*|}"
		IFS='|' read -r st hl <<<"$(svc::ps_lookup "$compose")"
		SVC_NAMES+=("$name"); SVC_COMPOSE+=("$compose")
		(( i == svc_cursor )) && mark='>' || mark=' '
		if (( detail )); then DASH_SVC_TSV+="$mark$name"$'\t'"$st"$'\t'"$hl"$'\n'
		else DASH_SVC_TSV+="$mark$name"$'\t'"$hl"$'\n'; fi
		i=$(( i + 1 ))
	done
	SVC_STACK_NAMES=("${SVC_STACKS[@]}")
	DASH_STACK_TSV=$'STACK\tSTATE\n'
	for s in "${SVC_STACKS[@]}"; do
		( printf '%s\t%s\n' "$s" "$(svc::stack_lookup "$s")" ) >>"$tmp" &
	done
	wait
	i=0
	for s in "${SVC_STACKS[@]}"; do
		st="$(awk -F'\t' -v n="$s" '$1==n {print $2; exit}' "$tmp")"
		(( i == stack_cursor )) && mark='>' || mark=' '
		DASH_STACK_TSV+="$mark$s"$'\t'"${st:-absent|-}"$'\n'
		i=$(( i + 1 ))
	done
	rm -f -- "$tmp"
}

svc::drill() { # SERVICE_INDEX -> action chooser (logs/restart/status)
	local idx="$1"
	local name="${SVC_NAMES[$idx]:-}" compose="${SVC_COMPOSE[$idx]:-}" pick
	[[ -n "$name" ]] || return 1
	pick="$(tui::choose "Service: $name" \
		"logs — tail 200 lines" \
		"restart — docker compose restart" \
		"status — ./cms status")" || return 1
	case "$pick" in
		logs*)    simple::run "Logs: $name" "docker compose logs --tail=200 $compose" ;;
		restart*) simple::run "Restart: $name" "docker compose restart $compose" ;;
		status*)  simple::run "Status: $name" "./cms status" ;;
	esac
}

svc::stack_drill() { # STACK_INDEX -> deploy/stop via stacks::run
	local idx="$1"
	local stack="${SVC_STACK_NAMES[$idx]:-}" pick
	[[ -n "$stack" ]] || return 1
	pick="$(tui::choose "Stack: $stack" \
		"deploy — stacks::run deploy" \
		"stop — stacks::run stop")" || return 1
	case "$pick" in
		deploy*) stacks::run deploy "$stack" ;;
		stop*)   stacks::run stop "$stack" ;;
	esac
}