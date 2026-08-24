#!/usr/bin/env bash
# scripts/__tui/__dashboard.sh — btop-style master dashboard (P2).
# Panels WORKERS/SERVICES/DATABASE/BACKUPS/UPDATES poll every 10s; mutating
# keys route through tui::confirm + tui::audit; falls back to
# scripts/__status.sh when tui::init fails. Source-safe: no side effects.

DASH_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/__tui/__engine.sh
source "$DASH_DIR/__engine.sh"

DASH_REFRESH_SECS=10
DASH_CORE_SERVICES="cms-database cms-log-service cms-resource-service cms-scoring-service cms-checker-service"
DASH_SVC_DETAIL=0
DASH_MSG=''
DASH_WORKERS_TSV=$'(not collected)' DASH_SVC_TSV=$'(not collected)'
DASH_DB_PANEL=('collecting…') DASH_BK_PANEL=('collecting…') DASH_UP_PANEL=('collecting…')

dash::env_val() { # FILE KEY -> value (blank when missing)
	awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

dash::paint() { if tui::tty_ok; then printf '\033[38;5;%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi; }

dash::state_color() { case "$1" in healthy|running|idle|true) echo "$TUI_OK" ;; unhealthy|absent|erroring|false) echo "$TUI_ERR" ;; starting|connecting|working|none) echo "$TUI_WARN" ;; *) echo "$TUI_DIM" ;; esac; }

dash::rows_tsv() { # JSON-ARRAY-ON-STDIN KEY... -> TSV rows (jq if present, else python3)
	local ks=("$@") prog
	if command -v jq >/dev/null 2>&1; then
		prog="map([$(printf '.%s,' "${ks[@]}" | sed 's/,$//')] | map(tostring))[] | @tsv"
		jq -r "$prog"
	else
		python3 -c '
import json, sys
[print("\t".join(str(r.get(k, "")) for k in sys.argv[1:])) for r in json.load(sys.stdin)]
' "${ks[@]}"
	fi
}

dash::collect_workers() {
	local rows
	rows=$(timeout 20 bash scripts/__worker_status_json.sh 2>/dev/null |
		dash::rows_tsv shard endpoint state activity || true)
	DASH_WORKERS_TSV=${rows:+$'SHARD\tENDPOINT\tSTATE\tACTIVITY\n'"$rows"}
	[[ -z "$rows" ]] && DASH_WORKERS_TSV=$'(no workers registered — run: ./cms worker deploy)'
}

dash::collect_services() {
	local svc raw out='' st hl rs
	for svc in $DASH_CORE_SERVICES; do
		raw=$(docker inspect -f '{{.State.Status}}|{{if .Config.Healthcheck}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}' "$svc" 2>/dev/null || true)
		if [[ -z "$raw" ]]; then st=absent hl=- rs=-; else IFS='|' read -r st hl rs <<<"$raw"; fi
		if (( DASH_SVC_DETAIL )); then
			out+="$svc"$'\t'"$st"$'\t'"$hl"$'\t'"$rs"$'\n'
		else
			out+="$svc"$'\t'"$hl"$'\n'
		fi
	done
	if (( DASH_SVC_DETAIL )); then
		DASH_SVC_TSV=$'SERVICE\tSTATUS\tHEALTH\tRESTARTS\n'"$out"
	else
		DASH_SVC_TSV=$'SERVICE\tHEALTH\n'"$out"
	fi
}

dash::collect_database() {
	local user db health contests=- users=-
	user=$(dash::env_val .env.core POSTGRES_USER); user=${user:-cmsuser}
	db=$(dash::env_val .env.core POSTGRES_DB);     db=${db:-cmsdb}
	health=$(docker inspect -f '{{.State.Health.Status}}' cms-database 2>/dev/null || echo absent)
	if [[ "$health" == healthy ]]; then
		contests=$(docker exec cms-database psql -U "$user" -d "$db" -tAc 'select count(*) from contests' 2>/dev/null || echo n/a)
		users=$(docker exec cms-database psql -U "$user" -d "$db" -tAc 'select count(*) from users' 2>/dev/null || echo n/a)
	fi
	DASH_DB_PANEL=(
		"health   $(dash::paint "$(dash::state_color "$health")" "$health")"
		"contests $contests"
		"users    $users"
		"user/db  ${user}/${db}"
	)
}

dash::human_age() { local s=$1; if (( s < 90 )); then printf '%ss' "$s"; elif (( s < 5400 )); then printf '%sm' $(( s / 60 )); elif (( s < 129600 )); then printf '%sh' $(( s / 3600 )); else printf '%sd' $(( s / 86400 )); fi; }

dash::collect_backups() {
	local latest ts
	latest=$(find backups -maxdepth 1 -type f -printf '%T@\t%p\n' 2>/dev/null | sort -rn | head -1 | cut -f2-)
	if [[ -z "$latest" ]]; then
		DASH_BK_PANEL=("latest   (none yet)" "hint     run: ./cms backup")
	else
		ts=$(stat -c %Y "$latest" 2>/dev/null || echo 0)
		DASH_BK_PANEL=(
			"latest   ${latest##*/}"
			"age      $(dash::human_age $(( $(date +%s) - ts ))) ago"
			"dir      backups/"
		)
	fi
}

dash::collect_updates() {
	local branch
	branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
	DASH_UP_PANEL=("branch   $branch" \
		"head     $(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
		"note     offline poll — no network fetch")
}

dash::collect_all() {
	dash::collect_workers
	dash::collect_services
	dash::collect_database
	dash::collect_backups
	dash::collect_updates
}

dash::join2() { # LEFT RIGHT -> side-by-side, padded to equal height
	local a="$1" b="$2" la lb
	la=$(printf '%s' "$a" | wc -l); lb=$(printf '%s' "$b" | wc -l)
	while (( la < lb )); do a+=$'\n'; la=$(( la + 1 )); done
	while (( lb < la )); do b+=$'\n'; lb=$(( lb + 1 )); done
	paste -d '' <(printf '%s' "$a") <(printf '%s' "$b")
}

dash::render_screen() {
	local w='' pair_a pair_b
	read -r _ w <<<"$(stty size </dev/tty 2>/dev/null)"
	w=${w:-100}
	printf '\033[H\033[2J'
	tui::header "CMS CONTROL PLANE" </dev/null
	dash::paint "$TUI_ACCENT" '▌ WORKERS'; printf '\n'
	printf '%s\n' "$DASH_WORKERS_TSV" | tui::table --print
	printf '\n'
	if (( w >= 132 )); then
		pair_a=$(dash::join2 "$(printf '%s\n' "$DASH_SVC_TSV" | tui::table --print)" \
			"$(tui::panel DATABASE "${DASH_DB_PANEL[@]}" </dev/null)")
		pair_b=$(dash::join2 "$(tui::panel BACKUPS "${DASH_BK_PANEL[@]}" </dev/null)" \
			"$(tui::panel UPDATES "${DASH_UP_PANEL[@]}" </dev/null)")
		printf '%s\n\n%s\n' "$pair_a" "$pair_b"
	else
		printf '%s\n' "$DASH_SVC_TSV" | tui::table --print; printf '\n'
		tui::panel DATABASE "${DASH_DB_PANEL[@]}" </dev/null; printf '\n'
		tui::panel BACKUPS "${DASH_BK_PANEL[@]}" </dev/null; printf '\n'
		tui::panel UPDATES "${DASH_UP_PANEL[@]}" </dev/null; printf '\n'
	fi
	dash::footer
}

dash::footer() {
	local msg=''
	[[ -n "$DASH_MSG" ]] && msg=" · $(dash::paint "$TUI_WARN" "$DASH_MSG")"
	dash::paint "$TUI_DIM" "r refresh · w worker-hint · s services-detail · d deploy-workers · b backup-now · ? help · q quit"
	printf '\nupdated %s%s\n' "$(date '+%H:%M:%S')" "$msg"
	DASH_MSG=''
}

dash::help() {
	printf '\033[H\033[2J'
	tui::header "DASHBOARD HELP" </dev/null
	tui::panel KEYBINDS \
		"r  refresh all panels now" \
		"w  hint: ./cms worker deploy" \
		"s  toggle SERVICES detail columns" \
		"d  deploy all workers → ./cms deploy worker" \
		"b  backup now        → ./cms backup" \
		"?  this overlay" \
		"q  quit (terminal restored)" </dev/null
	printf '\n'
	tui::panel SUBCOMMANDS \
		"./cms status | monitor | doctor | test" \
		"./cms deploy <core|admin|contest|worker|infra|all> [--img]" \
		"./cms stop [stack] | pull [stack] | clean [stack]" \
		"./cms backup [drill] | restore <archive>" \
		"./cms db <init|reset|clean|sync>" \
		"./cms worker [edit|deploy|stop|list]" </dev/null
	printf '\n%s' "$(dash::paint "$TUI_DIM" "press any key to return…")"
	dash::poll_key 30 && [[ "$KEY" == [qQ] ]] && exit 0
	return 0
}

dash::act() { # TEXT TAG CMD... — confirm+audit+spin guard for mutating keys
	local text="$1" tag="$2"; shift 2
	tui::confirm "$text" || return 1
	tui::audit "dashboard.$tag" "$*"
	tui::spin "$text" -- "$@"
	DASH_MSG="$tag finished (exit $?)"
}

dash::poll_key() { # TIMEOUT_S -> rc0 sets KEY iff bound user key; swallows ANSI reply litter inline
	KEY=''; local k
	while :; do
		IFS= read -rsn1 -t "${1:-1}" k || return 1
		if [[ "$k" == $'\x1b' ]]; then
			IFS= read -rsn1 -t 0.001 k || continue
			if [[ "$k" == ']' ]]; then
				while IFS= read -rsn1 -t 0.001 k && [[ "$k" != $'\a' && "$k" != $'\x1b' ]]; do :; done
				[[ "$k" == $'\x1b' ]] && IFS= read -rsn1 -t 0.001 k
			else while IFS= read -rsn1 -t 0.001 k && [[ "$k" != [A-Za-z~] ]]; do :; done; fi
			continue
		fi
		case "$k" in q|Q|r|R|w|W|s|S|d|D|b|B|h|H|\?) KEY=$k && return 0 ;; esac
	done
}

dash::loop() {
	local last=-9999
	while true; do
		if (( SECONDS - last >= DASH_REFRESH_SECS )); then
			dash::collect_all
			last=$SECONDS
		fi
		dash::render_screen
		dash::poll_key 1 || continue
		case "$KEY" in
			q|Q)    return 0 ;;
			r|R)    dash::collect_all; last=$SECONDS ;;
			w|W)    DASH_MSG="hint: run ./cms worker deploy" ;;
			s|S)    DASH_SVC_DETAIL=$(( 1 - DASH_SVC_DETAIL )); dash::collect_services ;;
			d|D)    if dash::act "Deploy ALL registered workers now?" deploy-worker ./cms deploy worker; then dash::collect_all; last=$SECONDS; fi ;;
			b|B)    if dash::act "Run a backup now?" backup ./cms backup; then dash::collect_backups; last=$SECONDS; fi ;;
			\?|h|H) dash::help ;;
		esac
	done
}

dash::teardown() {
	trap - EXIT INT TERM
	printf '\033[?1049l\033[0m'
	stty sane 2>/dev/null || true
}

dash::main() {
	if ! tui::init; then
		tui::plain
		exec bash scripts/__status.sh
	fi
	printf '\033[?1049h'
	trap 'exit 130' INT
	trap 'exit 143' TERM
	trap dash::teardown EXIT
	dash::collect_all
	dash::loop
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	set -u
	cd -- "$DASH_DIR/../.." || exit 1
	dash::main "$@"
fi
