#!/usr/bin/env bash
# scripts/__tui/__fleet.sh — gum TUI for the CMS worker fleet (P3).
# Rebuild of scripts/__worker_tui.sh over __tui/__engine.sh. Registry stays
# byte-compatible: WORKER_<shard>=<host>:<port> in .env.core plus optional
# WORKER_SHARD<n>_{LOCAL,MEMORY,CPU} flags in .env.worker. Deploy/stop/delete
# delegate to scripts/__worker_tui.sh so docker invocations stay identical.
# Source-safe: defines fleet::* only; callers run tui::init then fleet::main.
FLEET_ROOT="${FLEET_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
FLEET_CORE_ENV="${FLEET_CORE_ENV:-$FLEET_ROOT/.env.core}"
FLEET_WORKER_ENV="${FLEET_WORKER_ENV:-$FLEET_ROOT/.env.worker}"
FLEET_LEGACY="$FLEET_ROOT/scripts/__worker_tui.sh"
FLEET_LOG_TAIL="${FLEET_LOG_TAIL:-60}"; FLEET_BASE_PORT="${FLEET_BASE_PORT:-26000}"
FLEET_ROWS=()
fleet::env_val() { # FILE KEY -> value (exact key match, first hit)
	awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}
fleet::load() { # populate FLEET_ROWS as "shard|host|port|local|mem|cpu"
	FLEET_ROWS=()
	local tmp line key idx hp host port mem cpu loc gmem gcpu
	tmp="$(mktemp)"; awk -F= '/^WORKER_[0-9]+=/ {print}' "$FLEET_CORE_ENV" 2>/dev/null | sort -t_ -k3,3n >"$tmp" || true
	gmem="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_MEMORY_LIMIT || true)"; gcpu="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_CPU_LIMIT || true)"
	while IFS= read -r line || [[ -n $line ]]; do
		[[ -n $line ]] || continue
		key="${line%%=*}"; hp="${line#*=}"; idx="${key#WORKER_}"; host="${hp%%:*}"; port="${hp##*:}"
		[[ $idx =~ ^[0-9]+$ && $port =~ ^[0-9]+$ ]] || continue
		mem="$(fleet::env_val "$FLEET_WORKER_ENV" "WORKER_SHARD${idx}_MEMORY" || true)"; mem="${mem:-$gmem}"; mem="${mem:-512M}"
		cpu="$(fleet::env_val "$FLEET_WORKER_ENV" "WORKER_SHARD${idx}_CPU" || true)"; cpu="${cpu:-$gcpu}"; cpu="${cpu:-0.5}"
		loc="$(fleet::env_val "$FLEET_WORKER_ENV" "WORKER_SHARD${idx}_LOCAL" || true)"; loc="${loc:-1}"
		FLEET_ROWS+=("$idx|$host|$port|$loc|$mem|$cpu")
	done <"$tmp"
	rm -f "$tmp"
}
fleet::save() { # rewrite WORKER_N block in .env.core + optional flags in .env.worker
	local tmp row s h p l m c gm gc
	[[ -f $FLEET_CORE_ENV ]] || { printf 'fleet: %s missing\n' "$FLEET_CORE_ENV" >&2; return 1; }
	tmp="$(mktemp)"
	grep -v '^WORKER_[0-9]*=' "$FLEET_CORE_ENV" >"$tmp" || true
	for row in ${FLEET_ROWS[@]+"${FLEET_ROWS[@]}"}; do
		IFS='|' read -r s h p _ _ _ <<<"$row"; printf 'WORKER_%s=%s:%s\n' "$s" "$h" "$p" >>"$tmp"
	done
	mv "$tmp" "$FLEET_CORE_ENV"
	[[ -f $FLEET_WORKER_ENV ]] || return 0
	tmp="$(mktemp)"
	grep -vE '^WORKER_SHARD[0-9]+_(LOCAL|MEMORY|CPU)=' "$FLEET_WORKER_ENV" >"$tmp" || true
	gm="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_MEMORY_LIMIT || true)"; gc="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_CPU_LIMIT || true)"
	for row in ${FLEET_ROWS[@]+"${FLEET_ROWS[@]}"}; do
		IFS='|' read -r s h p l m c <<<"$row"
		[[ $l == 1 ]] || printf 'WORKER_SHARD%s_LOCAL=%s\n' "$s" "$l" >>"$tmp"
		{ [[ -n $gm ]] && [[ $m != "$gm" ]]; } && printf 'WORKER_SHARD%s_MEMORY=%s\n' "$s" "$m" >>"$tmp" || true
		{ [[ -n $gc ]] && [[ $c != "$gc" ]]; } && printf 'WORKER_SHARD%s_CPU=%s\n' "$s" "$c" >>"$tmp" || true
	done
	mv "$tmp" "$FLEET_WORKER_ENV"
}
fleet::_upsert_kv() { # FILE KEY VALUE — empty VALUE removes KEY
	local tmp; [[ -f $1 ]] || : >"$1"
	tmp="$(mktemp)"; grep -v "^$2=" "$1" >"$tmp" || true
	[[ -n $3 ]] && printf '%s=%s\n' "$2" "$3" >>"$tmp" || true
	mv "$tmp" "$1"
}
fleet::_state_word() { # SHARD -> plain state token for table/panel
	local st health; st="$(docker inspect -f '{{.State.Status}}' "cms-worker-$1" 2>/dev/null | tr -d '[:space:]')"
	[[ -n $st ]] || { printf -- '-'; return 0; }
	health="$(docker inspect -f '{{if .Config.Healthcheck}}{{.State.Health.Status}}{{else}}none{{end}}' "cms-worker-$1" 2>/dev/null | tr -d '[:space:]')"
	case "$st" in running) case "$health" in starting) st=STARTING ;; unhealthy) st=UNHEALTHY ;; *) st=UP ;; esac ;; exited|dead) st=EXITED ;; esac
	printf '%s' "$st"
}
fleet::_modified() { # SHARD -> container start time, '-' when absent
	local ts; ts="$(docker inspect -f '{{.State.StartedAt}}' "cms-worker-$1" 2>/dev/null | tr -d '[:space:]')"
	[[ -n $ts ]] || { printf -- '-'; return 0; }
	date -d "${ts%%.*}" '+%Y-%m-%d %H:%M' 2>/dev/null || printf -- '-'
}
fleet::_input() { # PROMPT [DEFAULT] -> value on stdout; nonzero = cancelled
	tui::tty_ok || { printf 'fleet: engine not initialized\n' >&2; return 127; }
	local v
	"$GUM_BIN" style --foreground "$TUI_DIM" --bold -- "$1" >&2; v="$("$GUM_BIN" input --placeholder "$1" --value "${2-}" --char-limit 128 </dev/tty)" || return 1
	printf '%s' "$v"
}
fleet::_shard_taken() { # EXCLUDE_IDX SHARD -> rc0 when another row owns SHARD
	local i s
	for i in "${!FLEET_ROWS[@]}"; do [[ $i != "$1" ]] || continue; s="${FLEET_ROWS[$i]%%|*}"; [[ $s != "$2" ]] || return 0; done; return 1
}
fleet::_ask_shard() { # EXCLUDE_IDX DEFAULT -> unique numeric shard on stdout
	local s
	while :; do
		s="$(fleet::_input "Shard number" "$2")" || return 1
		if [[ ! $s =~ ^[0-9]+$ ]]; then printf 'fleet: shard must be numeric\n' >&2
		elif fleet::_shard_taken "$1" "$s"; then printf 'fleet: shard %s already exists in registry\n' "$s" >&2
		else printf '%s' "$s"; return 0; fi
	done
}
fleet::_next_shard() { # lowest unused shard number in FLEET_ROWS
	local used=" " row s=0
	for row in ${FLEET_ROWS[@]+"${FLEET_ROWS[@]}"}; do used+=" ${row%%|*} "; done
	while [[ $used == *" $s "* ]]; do s=$((s + 1)); done
	printf '%s' "$s"
}
fleet::add_wizard() {
	fleet::load
	local s h p m c gm gc
	s="$(fleet::_next_shard)" || return 1
	s="$(fleet::_ask_shard -1 "$s")" || return 1
	h="$(fleet::_input "Registry host" "$(fleet::env_val "$FLEET_CORE_ENV" CORE_SERVICES_HOST || true)")" || return 1
	p="$(fleet::_input "Port" "$((FLEET_BASE_PORT + s))")" || return 1
	[[ $p =~ ^[0-9]+$ ]] || { printf 'fleet: port must be numeric\n' >&2; return 1; }
	gm="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_MEMORY_LIMIT || true)"; gc="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_CPU_LIMIT || true)"
	m="$(fleet::_input "Memory limit" "${gm:-512M}")" || return 1
	c="$(fleet::_input "CPU limit" "${gc:-0.5}")" || return 1
	tui::panel "New worker" "name: worker-$s (container cms-worker-$s)" "endpoint: $h:$p" "limits: $m / $c cpus"
	tui::confirm "Save shard $s to $FLEET_CORE_ENV?" || return 1
	FLEET_ROWS+=("$s|$h|$p|1|$m|$c")
	fleet::save || return 1
	tui::audit worker_add "shard=$s host=$h:$p mem=$m cpu=$c"
	printf 'Added shard %s — run "make env" to refresh cms.toml.\n' "$s"
}
fleet::edit_wizard() { # IDX
	fleet::load
	local idx="$1" row s h p l m c ns nh np nm nc
	[[ ${FLEET_ROWS[$idx]+x} ]] || { printf 'fleet: no such row\n' >&2; return 1; }
	row="${FLEET_ROWS[$idx]}"; IFS='|' read -r s h p l m c <<<"$row"
	ns="$(fleet::_ask_shard "$idx" "$s")" || return 1
	nh="$(fleet::_input "Registry host" "$h")" || return 1
	np="$(fleet::_input "Port" "$p")" || return 1
	[[ $np =~ ^[0-9]+$ ]] || { printf 'fleet: port must be numeric\n' >&2; return 1; }
	nm="$(fleet::_input "Memory limit" "$m")" || return 1; nc="$(fleet::_input "CPU limit" "$c")" || return 1
	tui::confirm "Save shard $s -> $ns ($nh:$np) to registry?" || return 1
	FLEET_ROWS[$idx]="$ns|$nh|$np|$l|$nm|$nc"
	fleet::save || { FLEET_ROWS[$idx]="$row"; return 1; }
	tui::audit worker_edit "shard=$s->$ns host=$nh:$np mem=$nm cpu=$nc"
	printf 'Updated shard %s — re-deploy to apply; run "make env" if the shard moved.\n' "$ns"
	fleet::_db_knob || true
}
fleet::_db_knob() { # prompt + persist WORKER_DB_HOST/_PORT into .env.worker
	local ch cp nh np
	ch="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_DB_HOST || true)"; cp="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_DB_PORT || true)"
	nh="$(fleet::_input "WORKER_DB_HOST (blank = default 'database')" "$ch")" || return 1
	np="$(fleet::_input "WORKER_DB_PORT (blank = 5432)" "$cp")" || return 1
	[[ $nh == "$ch" && $np == "$cp" ]] && return 0 || true
	tui::confirm "Persist WORKER_DB_HOST=${nh:-unset} WORKER_DB_PORT=${np:-unset} to $FLEET_WORKER_ENV?" || return 1
	fleet::_upsert_kv "$FLEET_WORKER_ENV" WORKER_DB_HOST "$nh"; fleet::_upsert_kv "$FLEET_WORKER_ENV" WORKER_DB_PORT "$np"
	tui::audit db_knob "host=${nh:-unset} port=${np:-unset}"
	printf 'DB knob saved — picked up by the next config injection.\n'
}
fleet::_delete() { # IDX — stop container then drop registry row
	local idx="$1" row s i out=()
	fleet::load
	[[ ${FLEET_ROWS[$idx]+x} ]] || return 1
	row="${FLEET_ROWS[$idx]}"; s="${row%%|*}"
	tui::confirm "Delete shard $s? Stops its container too." || return 1; "$FLEET_LEGACY" stop "$s" >/dev/null 2>&1 || true
	for i in "${!FLEET_ROWS[@]}"; do [[ $i == "$idx" ]] || out+=("${FLEET_ROWS[$i]}"); done
	FLEET_ROWS=("${out[@]+"${out[@]}"}")
	fleet::save || return 1
	tui::audit worker_delete "shard=$s"
	printf 'Deleted shard %s — run "make env" to refresh cms.toml.\n' "$s"
	return 0
}
fleet::deploy() { # TARGET all|shard
	tui::confirm "Deploy worker(s): $1 ?" || return 0
	local rc=0; tui::spin "deploying $1" -- "$FLEET_LEGACY" deploy "$1" || rc=$?
	(( rc == 0 )) && tui::audit deploy "target=$1 ok" || tui::audit deploy "target=$1 FAILED rc=$rc"
	(( rc == 0 )) && printf 'Deploy finished.\n' || true
	return "$rc"
}
fleet::stop() { # TARGET all|shard
	tui::confirm "Stop worker(s): $1 ?" || return 0
	local rc=0; tui::spin "stopping $1" -- "$FLEET_LEGACY" stop "$1" || rc=$?
	tui::audit stop "target=$1 rc=$rc"
	(( rc == 0 )) && printf 'Stop finished.\n' || true
	return "$rc"
}
fleet::logs() { # IDX — follow container logs, q detaches
	local idx="$1" row s key
	fleet::load
	[[ ${FLEET_ROWS[$idx]+x} ]] || return 1
	row="${FLEET_ROWS[$idx]}"; s="${row%%|*}"
	docker inspect "cms-worker-$s" >/dev/null 2>&1 || { printf 'no container cms-worker-%s yet\n' "$s"; return 0; }
	tui::confirm "Follow logs of cms-worker-$s (press q to detach)?" || return 0
	clear 2>/dev/null || true
	docker logs -f --tail "$FLEET_LOG_TAIL" "cms-worker-$s" 2>&1 </dev/null &
	local pid=$!
	while IFS= read -rsn1 key && [[ $key != q ]]; do :; done
	kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
	clear 2>/dev/null || true; tui::audit logs "cms-worker-$s detached"
}
fleet::detail() { # IDX — full config pane with per-worker actions
	fleet::load
	local idx="$1" row s h p l m c act dbh dbp scope
	[[ ${FLEET_ROWS[$idx]+x} ]] || return 1
	row="${FLEET_ROWS[$idx]}"; IFS='|' read -r s h p l m c <<<"$row"
	scope=local; [[ $l == 1 ]] || scope="remote (registry-only)"
	dbh="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_DB_HOST || true)"; dbp="$(fleet::env_val "$FLEET_WORKER_ENV" WORKER_DB_PORT || true)"
	tui::panel "Worker shard $s" \
		"container: cms-worker-$s" "endpoint: $h:$p" "scope: $scope" \
		"limits: $m mem / $c cpus" "db: ${dbh:-database}:${dbp:-5432}" \
		"state: $(fleet::_state_word "$s")" "modified: $(fleet::_modified "$s")"
	while :; do
		act="$(tui::choose "Action for shard $s" "Edit config" "Deploy" "Stop" "Logs" "Delete" "Back")" || return 0
		case "$act" in
			"Edit config") fleet::edit_wizard "$idx" && return 0 || true ;;
			Delete) fleet::_delete "$idx" && return 0 || true ;;
			Deploy) fleet::deploy "$s" || true ;;
			Stop) fleet::stop "$s" || true ;;
			Logs) fleet::logs "$idx" || true ;;
			*) return 0 ;;
		esac
	done
}
fleet::_pick_row() { # main selector -> add|deploy_all|stop_all|quit|#IDX...
	local opts=() row i=0 s h p pick
	for row in ${FLEET_ROWS[@]+"${FLEET_ROWS[@]}"}; do
		IFS='|' read -r s h p _ _ _ <<<"$row"
		opts+=("#$i shard=$s $h:$p $(fleet::_state_word "$s")"); i=$((i + 1))
	done
	opts+=("+ add worker" "! deploy all" "! stop all" "q quit")
	pick="$(tui::filter "Select worker or fleet action" ${opts[@]+"${opts[@]}"})" || return 1
	case "$pick" in
		"+"*) printf add ;; "! d"*) printf deploy_all ;;
		"! s"*) printf stop_all ;; q*) printf quit ;;
		\#*) printf '%s' "$pick" ;; *) return 1 ;;
	esac
}
fleet::render_table() { # themed gum table: shard | host | port | modified | state
	local tmp row s h p
	tmp="$(mktemp)"; printf 'SHARD\tHOST\tPORT\tMODIFIED\tSTATE\n' >"$tmp"
	for row in ${FLEET_ROWS[@]+"${FLEET_ROWS[@]}"}; do
		IFS='|' read -r s h p _ _ _ <<<"$row"
		printf '%s\t%s\t%s\t%s\t%s\n' "$s" "$h" "$p" "$(fleet::_modified "$s")" "$(fleet::_state_word "$s")" >>"$tmp"
	done
	tui::table -p -f "$tmp"; rm -f "$tmp"
}
fleet::run() {
	local pick idx
	while :; do
		clear 2>/dev/null || true
		tui::header "CMS Worker Fleet"; printf 'registry: %s · defaults: %s\n' "$FLEET_CORE_ENV" "$FLEET_WORKER_ENV"
		fleet::load
		fleet::render_table
		pick="$(fleet::_pick_row)" || { clear 2>/dev/null || true; return 0; }
		case "$pick" in
			add) fleet::add_wizard || true ;; deploy_all) fleet::deploy all || true ;;
			stop_all) fleet::stop all || true ;; quit) clear 2>/dev/null || true; return 0 ;;
			\#*) idx="${pick%% *}"; idx="${idx#\#}"; fleet::detail "$idx" || true ;;
		esac
	done
}
fleet::main() {
	tui::tty_ok || { printf 'fleet: run tui::init first\n' >&2; return 127; }; [[ -x $FLEET_LEGACY ]] || { printf 'fleet: %s missing\n' "$FLEET_LEGACY" >&2; return 1; }
	fleet::run
}
