#!/usr/bin/env bash
# scripts/__tui/__dashboard.sh — btop-style master dashboard (P2).
# Panels WORKERS/SERVICES/STACKS/DATABASE/BACKUPS/UPDATES poll every 10s;
# Tab/w cycles panels (active border highlighted), j/k moves the row cursor,
# Enter drills into the focused row; mutating keys route through
# tui::confirm + tui::audit; falls back to scripts/__status.sh when
# tui::init fails. Source-safe: no side effects.

DASH_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/__tui/__engine.sh
source "$DASH_DIR/__engine.sh"
# shellcheck source=scripts/__tui/runners/__simple.sh
source "$DASH_DIR/runners/__simple.sh"
# shellcheck source=scripts/__tui/runners/__services.sh
source "$DASH_DIR/runners/__services.sh"

DASH_REFRESH_SECS=10
DASH_SVC_DETAIL=0
DASH_MSG=''
DASH_ACTIVE=0
DASH_CURSOR=(0 0 0 0 0 0)
DASH_LAST_COLLECT=-9999
DASH_PANEL_NAMES=(WORKERS SERVICES STACKS DATABASE BACKUPS UPDATES)
DASH_WORKERS_TSV=$'(not collected)' DASH_SVC_TSV=$'(not collected)' DASH_STACK_TSV=$'(not collected)'
DASH_DB_PANEL=('collecting…') DASH_BK_PANEL=('collecting…') DASH_UP_PANEL=('collecting…')

dash::env_val() { # FILE KEY -> value (blank when missing)
	awk -F= -v k="$2" '$1==k {v=$0; sub(/^[^=]*=/,"",v); gsub(/^[ \t]+|[ \t\r]+$/,"",v); print v; exit}' "$1" 2>/dev/null || true
}

dash::paint() { if tui::tty_ok; then printf '\033[38;5;%sm%s\033[0m' "$1" "$2"; else printf '%s' "$2"; fi; }

dash::state_color() { case "$1" in healthy|running|idle|true) echo "$TUI_OK" ;; unhealthy|absent|erroring|false) echo "$TUI_ERR" ;; starting|connecting|working|restarting|paused|none) echo "$TUI_WARN" ;; *) echo "$TUI_DIM" ;; esac; }

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
	svc::collect "${DASH_CURSOR[1]}" "${DASH_CURSOR[2]}" "$DASH_SVC_DETAIL"
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

dash::join3() { # A B C -> side-by-side, padded to equal height
	local a="$1" b="$2" c="$3" la lb lc
	la=$(printf '%s' "$a" | wc -l); lb=$(printf '%s' "$b" | wc -l); lc=$(printf '%s' "$c" | wc -l)
	while (( la < lb || la < lc )); do a+=$'\n'; la=$(( la + 1 )); done
	while (( lb < la || lb < lc )); do b+=$'\n'; lb=$(( lb + 1 )); done
	while (( lc < la || lc < lb )); do c+=$'\n'; lc=$(( lc + 1 )); done
	paste -d '' <(printf '%s' "$a") <(printf '%s' "$b") <(printf '%s' "$c")
}

dash::table() { # ACTIVE [ARGS...] -> gum table from stdin; accent border when active
	local active="$1"; shift
	if ! tui::tty_ok; then cat; return 0; fi
	local border="$TUI_DIM"
	(( active )) && border="$TUI_ACCENT"
	"$GUM_BIN" table --border rounded \
		--border.foreground "$border" --header.foreground "$TUI_ACCENT" "$@"
}

dash::panel() { # TITLE ACTIVE CURSOR LINE... -> bordered block; accent border when active, '>' on cursor line
	local title="$1" active="$2" cursor="$3"; shift 3
	if ! tui::tty_ok; then
		local l i=0
		printf '[ %s ]\n' "$title"
		for l in "$@"; do
			if (( i == cursor )); then printf '> %s\n' "$l"; else printf '  %s\n' "$l"; fi
			i=$(( i + 1 ))
		done
		return 0
	fi
	local border="$TUI_DIM" i=0 l body=''
	(( active )) && border="$TUI_ACCENT"
	for l in "$@"; do
		if (( i == cursor )); then body+=$'\n'" >$l"; else body+=$'\n'"  $l"; fi
		i=$(( i + 1 ))
	done
	body="$("$GUM_BIN" style --bold --foreground "$TUI_ACCENT" -- "$title")$body"
	"$GUM_BIN" style --border rounded --border-foreground "$border" \
		--padding '1 2' --width 40 -- "$body"
}

dash::render_screen() {
	local w='' frame='' pair_a pair_b
	read -r _ w <<<"$(stty size </dev/tty 2>/dev/null)"
	w=${w:-100}

	local hdr workers svc stk db bk up ftr
	hdr=$(tui::header "CMS CONTROL PLANE" </dev/null)
	workers=$(printf '%s\n' "$DASH_WORKERS_TSV" | dash::table $(( DASH_ACTIVE == 0 )) --print)
	svc=$(printf '%s\n' "$DASH_SVC_TSV" | dash::table $(( DASH_ACTIVE == 1 )) --print)
	stk=$(printf '%s\n' "$DASH_STACK_TSV" | dash::table $(( DASH_ACTIVE == 2 )) --print)
	db=$(dash::panel DATABASE $(( DASH_ACTIVE == 3 )) "${DASH_CURSOR[3]}" "${DASH_DB_PANEL[@]}" </dev/null)
	bk=$(dash::panel BACKUPS $(( DASH_ACTIVE == 4 )) "${DASH_CURSOR[4]}" "${DASH_BK_PANEL[@]}" </dev/null)
	up=$(dash::panel UPDATES $(( DASH_ACTIVE == 5 )) "${DASH_CURSOR[5]}" "${DASH_UP_PANEL[@]}" </dev/null)

	if (( w >= 132 )); then
		pair_a=$(dash::join2 "$svc" "$stk")
		pair_b=$(dash::join3 "$db" "$bk" "$up")
		frame+="$hdr"$'\n'"$workers"$'\n'"$pair_a"$'\n\n'"$pair_b"
	else
		frame+="$hdr"$'\n'"$workers"$'\n'"$svc"$'\n'"$stk"$'\n'"$db"$'\n'"$bk"$'\n'"$up"
	fi

	ftr=$(dash::footer)
	frame+=$'\n'"$ftr"$'\033[J'

	printf '\033[H%s' "$frame"
}

dash::footer() {
	local msg=''
	[[ -n "$DASH_MSG" ]] && msg=" · $(dash::paint "$TUI_WARN" "$DASH_MSG")"
	dash::paint "$TUI_ACCENT" "▶ ${DASH_PANEL_NAMES[$DASH_ACTIVE]}"
	dash::paint "$TUI_DIM" " · Tab/w panels · j/k row · Enter drill · r refresh · s detail · d workers · a ALL · u update · b backup · f features · ? help · q quit"
	printf '\nupdated %s%s\n' "$(date '+%H:%M:%S')" "$msg"
	DASH_MSG=''
}

dash::help() {
	printf '\033[H\033[2J'
	tui::header "DASHBOARD HELP" </dev/null
	tui::panel KEYBINDS \
		"Tab/w  cycle panels (active border highlighted)" \
		"j/k    move row cursor within panel" \
		"Enter  drill into focused row" \
		"r  refresh all panels now" \
		"s  toggle SERVICES detail columns" \
		"d  deploy all workers (fleet) → ./cms worker deploy all" \
		"a  deploy ALL stacks      → ./cms deploy all (–img prompt)" \
		"u  update server (full)   → ./cms update-server" \
		"f  features launcher      → 16-cmd picker" \
		"b  backup now        → ./cms backup" \
		"?  this overlay" \
		"q  quit (terminal restored)" </dev/null
	printf '\n'
	tui::panel PANELS \
		"WORKERS  Enter → fleet TUI (./cms worker tui)" \
		"SERVICES Enter → logs/restart/status per service" \
		"STACKS   Enter → deploy/stop per stack" \
		"DATABASE Enter → db menu (init/reset/clean/sync)" \
		"BACKUPS  Enter → backup now" \
		"UPDATES  Enter → update-server" </dev/null
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

dash::features() {
	local pick cmd
	pick="$(tui::choose "Features — ./cms <cmd>" \
		"status — Status dashboard" \
		"monitor — Monitor services" \
		"backup — Backup now" \
		"restore — Restore from backup" \
		"doctor — Doctor diagnostics" \
		"test — Self test" \
		"db — Database tools" \
		"admin-create — Create admin" \
		"contest — Switch contest" \
		"pull — Pull upstream" \
		"deploy — Deploy workers" \
		"stop — Stop services" \
		"clean — Clean artifacts" \
		"tailscale — Tailscale setup" \
		"funnel — Funnel exposure" \
		"update-server — Update server")" || return 1
	cmd="${pick%% *}"
	simple::run "Features: $pick" "./cms $cmd"
}

dash::next_panel() { DASH_ACTIVE=$(( (DASH_ACTIVE + 1) % 6 )); }
dash::prev_panel() { DASH_ACTIVE=$(( (DASH_ACTIVE + 5) % 6 )); }

dash::panel_rows() { # PANEL_IDX -> data-row count of that panel
	case "$1" in
		0) printf '%s' "$(( $(printf '%s\n' "$DASH_WORKERS_TSV" | wc -l) - 1 ))" ;;
		1) printf '%s' "${#SVC_NAMES[@]}" ;;
		2) printf '%s' "${#SVC_STACK_NAMES[@]}" ;;
		3) printf '%s' "${#DASH_DB_PANEL[@]}" ;;
		4) printf '%s' "${#DASH_BK_PANEL[@]}" ;;
		5) printf '%s' "${#DASH_UP_PANEL[@]}" ;;
	esac
}

dash::cursor_move() { # +1/-1 -> clamp cursor within active panel's rows
	local rows n
	rows=$(dash::panel_rows "$DASH_ACTIVE")
	(( rows > 0 )) || return 0
	n=$(( DASH_CURSOR[DASH_ACTIVE] + $1 ))
	(( n < 0 )) && n=0
	(( n >= rows )) && n=$(( rows - 1 ))
	DASH_CURSOR[DASH_ACTIVE]=$n
}

dash::db_menu() { # DATABASE drill -> make-target chooser (mirrors main::db_menu)
	local sub target
	sub="$(tui::choose "Database operation (make target)" init reset clean sync back)" || return 0
	case "$sub" in
		back) return 0 ;;
		init) target=cms-init ;;
		reset) target='db-reset' ;;
		clean) target='db-clean' ;;
		sync) target=prisma-sync ;;
	esac
	simple::run "db $sub (make $target)" "make $target"
}

dash::drill_active() { # Enter on active panel -> panel-specific drill; always refresh after
	case "$DASH_ACTIVE" in
		0) ./cms worker tui ;;
		1) svc::drill "${DASH_CURSOR[1]}" ;;
		2) svc::stack_drill "${DASH_CURSOR[2]}" ;;
		3) dash::db_menu ;;
		4) dash::act "Run a backup now?" backup ./cms backup ;;
		5) dash::act "Run full server update (git pull + images + db)?" update-server ./cms update-server ;;
	esac
	dash::collect_all
	DASH_LAST_COLLECT=$SECONDS
}

dash::poll_key() { # TIMEOUT_S -> rc0 sets KEY iff bound user key; swallows ANSI reply litter inline
	KEY=''; local k
	while :; do
		IFS= read -rsn1 -t "${1:-1}" k || return 1
		if [[ "$k" == $'\x1b' ]]; then
			IFS= read -rsn1 -t 0.001 k || continue
			if [[ "$k" == '[' ]]; then
				IFS= read -rsn1 -t 0.001 k || continue
				case "$k" in
					A) KEY=up && return 0 ;;
					B) KEY=down && return 0 ;;
					C) KEY=right && return 0 ;;
					D) KEY=left && return 0 ;;
					*) while IFS= read -rsn1 -t 0.001 k && [[ "$k" != [A-Za-z~] ]]; do :; done ;;
				esac
			elif [[ "$k" == ']' ]]; then
				while IFS= read -rsn1 -t 0.001 k && [[ "$k" != $'\a' && "$k" != $'\x1b' ]]; do :; done
				[[ "$k" == $'\x1b' ]] && IFS= read -rsn1 -t 0.001 k
			else while IFS= read -rsn1 -t 0.001 k && [[ "$k" != [A-Za-z~] ]]; do :; done; fi
			continue
		fi
		case "$k" in
			q|Q|r|R|w|W|s|S|d|D|b|B|a|A|u|U|f|F|h|H|\?|j|J|k|K|$'\t'|$'\r'|$'\n') KEY=$k && return 0 ;;
		esac
	done
}

dash::loop() {
	while true; do
		if (( SECONDS - DASH_LAST_COLLECT >= DASH_REFRESH_SECS )); then
			dash::collect_all
			DASH_LAST_COLLECT=$SECONDS
		fi
		dash::render_screen
		dash::poll_key 1 || continue
		case "$KEY" in
			q|Q)    return 0 ;;
			r|R)    dash::collect_all; DASH_LAST_COLLECT=$SECONDS ;;
			$'\t'|w|W|right) dash::next_panel ;;
			left)   dash::prev_panel ;;
			j|J|down) dash::cursor_move 1 ;;
			k|K|up) dash::cursor_move -1 ;;
			$'\r'|$'\n'|'') dash::drill_active ;;
			s|S)    DASH_SVC_DETAIL=$(( 1 - DASH_SVC_DETAIL )); svc::collect "${DASH_CURSOR[1]}" "${DASH_CURSOR[2]}" "$DASH_SVC_DETAIL" ;;
			d|D)    if dash::act "Deploy ALL registered workers now?" deploy-fleet ./cms worker deploy all; then dash::collect_all; DASH_LAST_COLLECT=$SECONDS; fi ;;
			a|A)    if dash::act "Deploy ALL stacks (core infra admin contest worker)?" deploy-all ./cms deploy all; then dash::collect_all; DASH_LAST_COLLECT=$SECONDS; fi ;;
			u|U)    if dash::act "Run full server update (git pull + images + db)?" update-server ./cms update-server; then dash::collect_all; DASH_LAST_COLLECT=$SECONDS; fi ;;
			f|F)    if dash::features; then dash::collect_all; DASH_LAST_COLLECT=$SECONDS; fi ;;
			b|B)    if dash::act "Run a backup now?" backup ./cms backup; then dash::collect_backups; DASH_LAST_COLLECT=$SECONDS; fi ;;
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