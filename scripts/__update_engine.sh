#!/usr/bin/env bash
# __update_engine.sh — configuration update engine for CMS Docker.
#
# Modes:
#   (none)   Interactive section walk over all managed variables.
#   --fix    Non-interactive: regenerate ONLY missing/invalid required vars.
#   --fresh  Full first-time walk: every var written, defaults offered instead
#            of keeping current values.
#
# Helpers ported from the legacy setup.sh (absorbed into this engine).
set -eu
# pipefail only if available
if (set -o pipefail 2>/dev/null); then
    set -o pipefail
fi

CMS_ROOT="${CMS_DOCKER_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$CMS_ROOT"

if [[ -f "scripts/__lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "scripts/__lib/common.sh"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/__lib/common.sh" ]]; then
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/__lib/common.sh"
fi
declare -F log_info >/dev/null 2>&1 || log_info() { printf '[INFO] %s\n' "$*"; }
declare -F log_warn >/dev/null 2>&1 || log_warn() { printf '[WARN] %s\n' "$*" >&2; }
declare -F log_die  >/dev/null 2>&1 || log_die()  { printf '[FAIL] %s\n' "${1:-fatal}" >&2; exit "${2:-1}"; }
declare -F is_default_secret >/dev/null 2>&1 || is_default_secret() {
  local v="${1:-}"
  [ -z "$v" ] && return 0
  case "$v" in cmspassword|usern4me|passw0rd|DEFAULT_SECRET_KEY) return 0 ;; esac
  [[ "$v" == CHANGE_ME* || "$v" == YOUR_* || "$v" == *PASSWORD_HERE* ]]
}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error()   { echo -e "${RED}[✗]${NC} $1"; }
print_step()    { echo -e "${CYAN}[STEP]${NC} $1"; }

DRY_RUN=false
CONFIG_TOML="config.toml"
CONFIG_EXAMPLE="config.toml.example"
ASSUME_YES=0
MODE="walk"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --fix)     MODE="fix" ;;
    --fresh)   MODE="fresh" ;;
    --update-server) MODE="update-server" ;;
    --yes|-y)  ASSUME_YES=1 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) log_die "unknown option: $arg (use: --fix | --fresh | --dry-run | --yes)" 2 ;;
  esac
done

# quote_toml_value <value> — bare for true/false/pure numbers, else double-quoted
quote_toml_value() { case "$1" in true|false) echo "$1";; *[!0-9]*|"") echo "\"$1\"";; *) echo "$1";; esac; }

# Rewrite KEY inside [section] of config.toml, preserving any trailing inline
# comment. $1 is the section header as written in the file, e.g. "[core]".
# Bare value for true/false/pure numbers, double-quoted otherwise. A missing
# key is appended to its section; a missing section is appended at EOF.
update_toml_var() {
    local section=$1
    local key=$2
    local value=$3
    local toml="$CONFIG_TOML"

    if [ ! -f "$toml" ]; then
        cp "$CONFIG_EXAMPLE" "$toml"
    fi

    local line
    line="${key} = $(quote_toml_value "$value")"

    local tmp
    tmp=$(mktemp)
    awk -v section="$section" -v k="$key" -v newline="$line" '
        { line = $0; sub(/[ \t\r]+$/, "", line); if (line == section) { insec = 1; seen = 1; print; next } }
        /^\[/ {
            if (insec && !done) { print newline; done = 1 }
            insec = 0; print; next
        }
        insec && !done {
            p = $1; gsub(/[ \t]/, "", p)
            if (p == k) {
                comment = ""
                idx = index($0, "#")
                if (idx > 0) comment = " " substr($0, idx)
                print newline comment
                done = 1
                next
            }
        }
        { print }
        END {
            if (insec && !done) { print newline }
            else if (!seen) { print ""; print section; print newline }
        }
    ' "$toml" > "$tmp"
    mv "$tmp" "$toml"
}

run_or_print() {
    local command="$1"
    if [ "$DRY_RUN" = "true" ]; then
        echo "DRY-RUN: Would run: $command"
    else
        eval "$command"
    fi
}

is_positive_int() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
        *) [ "$1" -gt 0 ] ;;
    esac
}

check_connection() {
    local host=$1
    local port=$2
    local timeout=3
    if timeout $timeout bash -c "cat < /dev/tcp/$host/$port" >/dev/null 2>&1; then
        return 0
    elif command -v nc >/dev/null 2>&1; then
        nc -z -w $timeout "$host" "$port" >/dev/null 2>&1
        return $?
    fi
    return 1
}

run_update_mode() {
    print_step "Update Mode"
    print_info "Using automated shard-aware update script (scripts/__update-server.sh)..."
    chmod +x scripts/__update-server.sh
    ./scripts/__update-server.sh
    print_success "Update completed via update-server.sh."
    exit 0
}

ensure_worker_cgroup_setup() {
    if [ ! -d "/sys/fs/cgroup/cms-isolate" ]; then
        echo ""
        print_warning "Worker sandbox cgroups not found (/sys/fs/cgroup/cms-isolate)."
        read -p "Would you like to automatically configure worker cgroups now? (Requires sudo) (y/n) [y]: " AUTO_CGROUP
        AUTO_CGROUP=${AUTO_CGROUP:-y}
        if [ "$AUTO_CGROUP" = "y" ]; then
            print_info "Running __worker_cgroup_setup.sh..."
            chmod +x ./scripts/__worker_cgroup_setup.sh
            if sudo ./scripts/__worker_cgroup_setup.sh; then
                print_success "Worker cgroups configured successfully."
            else
                print_error "Failed to configure cgroups. Worker might not start correctly."
            fi
        else
            print_warning "Cgroup setup skipped. You may need to run scripts/__worker_cgroup_setup.sh manually."
        fi
    fi
}

configure_ranking_auth() {
    echo ""
    print_step "Contest & Ranking Authentication"

    local existing_ranking_username
    local existing_ranking_password

    existing_ranking_username=$(get_var "[admin]" RANKING_USERNAME)
    existing_ranking_password=$(get_var "[admin]" RANKING_PASSWORD)

    if [ "$MODE" = "fix" ]; then
        if [ -n "$existing_ranking_username" ] && ! is_default_secret "$existing_ranking_password"; then
            print_info "Ranking credentials present — nothing to fix."
            return 0
        fi
        RANKING_USERNAME_INPUT="${existing_ranking_username:-admin}"
        RANKING_PASSWORD_INPUT=$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)
        print_info "RANKING_PASSWORD: <generated>"
    else
        read -r -p "Ranking username [${existing_ranking_username:-admin}]: " RANKING_USERNAME_INPUT
        RANKING_USERNAME_INPUT=${RANKING_USERNAME_INPUT:-${existing_ranking_username:-admin}}

        read -r -s -p "Ranking password [hidden, leave blank to keep current]: " RANKING_PASSWORD_INPUT
        echo ""
        if [ -z "$RANKING_PASSWORD_INPUT" ]; then
            RANKING_PASSWORD_INPUT=$existing_ranking_password
        fi
        if is_default_secret "$RANKING_PASSWORD_INPUT"; then
            RANKING_PASSWORD_INPUT=$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)
            print_info "RANKING_PASSWORD: <generated>"
        fi
    fi

    if [ "$DRY_RUN" = "true" ]; then
        echo "DRY-RUN: Would update config.toml [admin]: RANKING_USERNAME=$RANKING_USERNAME_INPUT"
        echo "DRY-RUN: Would update config.toml [admin]: RANKING_PASSWORD=<hidden>"
        echo "DRY-RUN: Would run: make env"
        echo "DRY-RUN: Would run: ./scripts/__inject_config.sh"
        return
    fi

    update_toml_var "[admin]" "RANKING_USERNAME" "$RANKING_USERNAME_INPUT"
    update_toml_var "[admin]" "RANKING_PASSWORD" "$RANKING_PASSWORD_INPUT"
    propagate_generated
    print_success "Ranking credentials updated in config.toml [admin], .env, config/cms.toml, and config/cms_ranking.toml"
}

propagate_generated() {
    if [ ! -f Makefile ]; then
        print_warning "No Makefile here — skipping derived-file propagation (make env / inject_config)."
        return 0
    fi
    run_or_print "make env"
    if [ -x ./scripts/__inject_config.sh ] || [ -f ./scripts/__inject_config.sh ]; then
        run_or_print "./scripts/__inject_config.sh"
    fi
}

# Bootstrap config.toml from the tracked example. $1 (section) is accepted
# for call-site compatibility and ignored — one config file, one bootstrap.
ensure_config_toml() {
    if [ ! -f "$CONFIG_TOML" ] && [ -f "$CONFIG_EXAMPLE" ]; then
        if [ "$DRY_RUN" = "true" ]; then
            echo "DRY-RUN: Would template $CONFIG_TOML from $CONFIG_EXAMPLE"
        else
            cp "$CONFIG_EXAMPLE" "$CONFIG_TOML"
            print_info "Templated $CONFIG_TOML from $CONFIG_EXAMPLE"
        fi
    fi
}

# read_toml_value <file> <section-header> <key> — prints the value
# (comment stripped, trimmed, dequoted); empty output when absent.
read_toml_value() {
    local toml_file=$1 section=$2 key=$3
    [ -f "$toml_file" ] || return 0
    awk -F= -v section="$section" -v k="$key" '
        { line = $0; sub(/[ \t\r]+$/, "", line); if (line == section) { insec = 1; next } }
        /^\[/ { insec = 0 }
        insec {
            p = $1; gsub(/[ \t]/, "", p)
            if (p == k) {
                v = $0; sub(/^[^=]*=/, "", v)
                sub(/[[:space:]]*#.*$/, "", v)
                gsub(/^[ \t]+|[ \t\r]+$/, "", v)
                gsub(/^"|"$/, "", v)
                print v
                exit
            }
        }
    ' "$toml_file" 2>/dev/null | tr -d '\r' || true
}

# Read KEY from [section] in config.toml ($1 = section header, e.g. "[core]").
get_var() {
    read_toml_value "$CONFIG_TOML" "$1" "$2"
}

# Default for KEY from [section] in the tracked config.toml.example.
get_default_for() {
    read_toml_value "$CONFIG_EXAMPLE" "$1" "$2"
}

get_status() {
    local key=$1 current=$2 default_val=$3
    if [ -z "$current" ]; then echo "MISSING"; return; fi
    if is_default_secret "$current"; then echo "DEFAULT"; return; fi
    if [ -n "$default_val" ] && [ "$current" = "$default_val" ]; then echo "DEFAULT"; return; fi
    if [ -z "$default_val" ] && [ "$current" = "" ]; then echo "MISSING"; return; fi
    echo "CUSTOM"
}

show_vars_table() {
    local use_tui=0
    if declare -F tui::tty_ok >/dev/null 2>&1 && tui::tty_ok 2>/dev/null; then use_tui=1; fi
    local header="Var\tCurrent\tDefault\tStatus\tSection"
    local rows=""
    local spec group section key type required default_cur current defval status cur_disp def_disp
    for spec in "${VAR_SPECS[@]}"; do
        IFS='|' read -r group section key type required default_cur <<<"$spec"
        current=$(get_var "$section" "$key")
        defval=$(get_default_for "$section" "$key")
        [ -z "$defval" ] && defval="$default_cur"
        status=$(get_status "$key" "$current" "$defval")
        cur_disp=$(mask_show "$key" "$current")
        def_disp=$(mask_show "$key" "$defval")
        rows+="${key}\t${cur_disp}\t${def_disp}\t${status}\t${section}"$'\n'
    done
    if [ "$use_tui" = "1" ]; then
        { echo -e "$header"; echo -e "$rows"; } | tui::table
    else
        printf "%-28s %-22s %-22s %-10s %s\n" "Var" "Current" "Default" "Status" "Section"
        printf "%-28s %-22s %-22s %-10s %s\n" "----------------------------" "----------------------" "----------------------" "----------" "--------------"
        while IFS=$'\t' read -r key cur def stat section_disp; do
            [ -z "$key" ] && continue
            printf "%-28s %-22s %-22s %-10s %s\n" "$key" "$cur" "$def" "$stat" "$section_disp"
        done <<<"$(echo -e "$rows")"
    fi
}

ask_var() {
    local section=$1 key=$2 type=$3 required=$4 default_spec=$5 fresh=$6
    local current default_val status cur_disp def_disp
    current=$(get_var "$section" "$key")
    default_val=$(get_default_for "$section" "$key")
    [ -z "$default_val" ] && default_val="$default_spec"
    status=$(get_status "$key" "$current" "$default_val")
    cur_disp=$(mask_show "$key" "$current")
    def_disp=$(mask_show "$key" "$default_val")
    if [ "$MODE" = "fix" ]; then
        needs_fix "$section" "$key" "$type" "$required" || { echo "$current"; return; }
        local gen=$(generate_for "$key" "$default_spec")
        [ -z "$gen" ] && gen="$default_val"
        echo "$gen"
        return
    fi
    if [ "$ASSUME_YES" = "1" ] || [ "${CMS_YES:-0}" = "1" ] || [ "$DRY_RUN" = "true" ]; then
        if [ -n "$current" ] && ! is_default_secret "$current"; then echo "$current"; return; fi
        local gen2=$(generate_for "$key" "$default_spec")
        echo "${gen2:-$default_val}"
        return
    fi
    local use_tui=0
    if declare -F tui::tty_ok >/dev/null 2>&1 && tui::tty_ok 2>/dev/null; then use_tui=1; fi
    if [ "$use_tui" = "1" ]; then
        tui::panel "$key" "Current: $cur_disp" "Default: $def_disp" "Status: $status" "Section: $section"
    else
        echo "  $key [current: $cur_disp] (default: $def_disp) Status: $status"
    fi
    prompt_var "$section" "$key" "$type" "$required" "$default_spec" "$fresh"
}


select_services() {
  local defaults="core admin contest worker infra"
  if declare -F tui::choose_multi >/dev/null 2>&1; then
    SERVICES_SELECTED=$(tui::choose_multi \
      "Select services to configure on this node" \
      "core" "admin" "contest" "worker" "infra")
  else
    echo "  Services [core,admin,contest,worker,infra]: "
    read -r ans
    SERVICES_SELECTED="${ans:-$defaults}"
  fi
  # Ensure spaces for filtering
  SERVICES_SELECTED=" ${SERVICES_SELECTED//,/ } "
}

filter_specs() {
  ACTIVE_SPECS=()
  for spec in "${VAR_SPECS[@]}"; do
    IFS='|' read -r group section key type required default <<<"$spec"
    case "$group" in
      "Core & Network") service="core" ;;
      "Admin Panel")    service="admin" ;;
      "Contest")        service="contest" ;;
      "Worker")         service="worker" ;;
      "Infra & Monitoring") service="infra" ;;
      *) service="none" ;;
    esac
    if [[ " $SERVICES_SELECTED " == *" $service "* ]]; then
      ACTIVE_SPECS+=("$spec")
    fi
  done
}

run_tui_vars_wizard() {
    select_services
    filter_specs
    local total=${#ACTIVE_SPECS[@]}
    print_step "Interactive variable review — ${total} vars (j/k move, e edit, c keep, a apply all, q quit)"
    show_vars_table
    declare -A __pending
    local spec group section key type required default
    for spec in "${ACTIVE_SPECS[@]}"; do
        IFS='|' read -r group section key type required default <<<"$spec"
        __pending["$key"]=$(get_var "$section" "$key")
    done
    while true; do
        echo ""
        local options=()
        for spec in "${ACTIVE_SPECS[@]}"; do
            IFS='|' read -r group section key type required default <<<"$spec"
            local cur; cur=$(get_var "$section" "$key")
            local def; def=$(get_default_for "$section" "$key"); [ -z "$def" ] && def="$default"
            local st; st=$(get_status "$key" "$cur" "$def")
            local cur_d
            cur_d=$(mask_show "$key" "$cur")
            options+=("${key} [${st}] ${cur_d} -> ${def} (${section})")
        done
        options+=(">>> APPLY ALL CONFIRMED <<<" ">>> QUIT WITHOUT SAVING <<<")
        local choice
        if ! choice=$(tui::choose "Select variable (j/k move, Enter act)" "${options[@]}"); then
            print_warning "Selection cancelled — staying in wizard."
            continue
        fi
        case "$choice" in
            ">>> APPLY ALL CONFIRMED <<<")
                if tui::confirm "Apply all confirmed values to config.toml?"; then
                    break
                fi
                ;;
            ">>> QUIT WITHOUT SAVING <<<")
                if tui::confirm "Quit without saving? Unconfirmed changes will be lost."; then
                    log_die "aborted by user" 0
                fi
                ;;
            *)
                local sel_key
                sel_key=$(echo "$choice" | awk '{print $1}')
                for spec in "${ACTIVE_SPECS[@]}"; do
                    IFS='|' read -r group section key type required default <<<"$spec"
                    if [ "$key" = "$sel_key" ]; then
                        CURRENT_GROUP="$group"
                        ensure_config_toml "$section"
                        local act
                        act=$(tui::choose "Action for $key ($section) — e edit / c keep / u default / q back" "e) edit value" "c) confirm keep" "u) update to default" "q) back") || break
                        case "$act" in
                            e* )
                                local newval
                                newval=$(prompt_var "$section" "$key" "$type" "$required" "$default" "$FRESH")
                                __pending["$key"]="$newval"
                                local cur0
                                cur0=$(get_var "$section" "$key")
                                if [ "$newval" = "$cur0" ] && [ "$FRESH" -eq 0 ]; then
                                    record_stat "$group" kept
                                else
                                    apply_var "$section" "$key" "$newval" changed
                                fi
                                ;;
                            c* )
                                record_stat "$group" kept
                                ;;
                            u* )
                                local def2
                                def2=$(get_default_for "$section" "$key"); [ -z "$def2" ] && def2="$default"
                                local gen
                                gen=$(generate_for "$key" "$default"); [ -z "$gen" ] && gen="$def2"
                                if [ -n "$gen" ]; then
                                    __pending["$key"]="$gen"
                                    apply_var "$section" "$key" "$gen" changed
                                else
                                    print_warning "No default/generator for $key — keeping current."
                                    record_stat "$group" kept
                                fi
                                ;;
                            *) : ;;
                        esac
                        show_vars_table
                        break
                    fi
                done
                ;;
        esac
    done
}

gen_hex32()  { openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(16))'; }
gen_pw()     { openssl rand -base64 12 2>/dev/null | tr -d "=+/" | cut -c1-16; }
gen_live_ip(){ curl -s -4 --max-time 5 ifconfig.me 2>/dev/null || echo "127.0.0.1"; }
gen_docker_gid() { stat -c %g /var/run/docker.sock 2>/dev/null || echo "999"; }

is_secret_key() { [[ "$1" =~ (PASSWORD|SECRET|TOKEN|KEY) ]]; }

mask_show() {
    if is_secret_key "$1"; then
        local v="${2:-}"
        if [ -z "$v" ]; then echo "<empty>"; elif is_default_secret "$v"; then echo "<default-insecure>"; else echo "<hidden>"; fi
    else
        echo "${2:-<empty>}"
    fi
}

COUNT_CHANGED=0
COUNT_KEPT=0
COUNT_GENERATED=0
GROUP_STATS=""

record_stat() {
    local group=$1 kind=$2
    case "$kind" in
        changed)   COUNT_CHANGED=$((COUNT_CHANGED+1)) ;;
        kept)      COUNT_KEPT=$((COUNT_KEPT+1)) ;;
        generated) COUNT_GENERATED=$((COUNT_GENERATED+1)) ;;
    esac
    GROUP_STATS+="${group}|${kind}"$'\n'
}

apply_var() {
    local section=$1 key=$2 value=$3 kind=$4
    if [ "$DRY_RUN" = "true" ]; then
        echo "DRY-RUN: Would update $section: $(is_secret_key "$key" && echo "${key}=<hidden>" || echo "${key}=${value}") [$kind]"
    else
        update_toml_var "$section" "$key" "$value"
        if is_secret_key "$key"; then
            print_success "$key: <hidden> [$kind]"
        else
            print_success "$key: ${value} [$kind]"
        fi
    fi
    record_stat "$CURRENT_GROUP" "$kind"
}

generate_for() {
    local key=$1 gen=$2
    case "$gen" in
        hex32)    gen_hex32 ;;
        rand_pw)  gen_pw ;;
        live_ip)  gen_live_ip ;;
        docker_gid) gen_docker_gid ;;
        mirror_public_ip) get_var "[core]" PUBLIC_IP ;;
        *) echo "" ;;
    esac
}

validate_value() {
    local type=$1 value=$2
    case "$type" in
        port)     is_positive_int "$value" ;;
        num)      case "$value" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac ;;
        bool)     [[ "$value" == "true" || "$value" == "false" ]] ;;
        enum:*)   local opts="${type#enum:}"; [[ ",$opts," == *",$value,"* ]] ;;
        url)      [[ -z "$value" || "$value" == https://* || "$value" == http://* ]] ;;
        *)        return 0 ;;
    esac
}

prompt_var() {
    local section=$1 key=$2 type=$3 required=$4 default=$5 fresh=$6
    local current
    current=$(get_var "$section" "$key")
    local label
    label=$(mask_show "$key" "$current")
    local ans chosen gen_out eof=0
    pwarn() { print_warning "$1" >&2; }

    while :; do
        if is_secret_key "$key"; then
            if [ "$fresh" = "1" ]; then
                read -r -p "  ${key} [Enter=generate, g=generate, t=type]: " ans || { ans=""; eof=1; }
            else
                read -r -p "  ${key} current: ${label} — [Enter=keep] g=generate t=type: " ans || { ans=""; eof=1; }
            fi
            case "$ans" in
                "") if [ "$fresh" != "1" ] && [ -n "$current" ] && ! is_default_secret "$current"; then
                        echo "$current"; return
                    fi
                    gen_out=$(generate_for "$key" "$default")
                    echo "${gen_out:-$default}"
                    return ;;
                g|G) gen_out=$(generate_for "$key" "$default"); echo "${gen_out:-$default}"; return ;;
                t|T) read -r -s -p "  value: " typed; echo ""; echo "$typed" ;;
                *) pwarn "invalid choice"; continue ;;
            esac
            return
        fi

        if [ "$fresh" = "1" ]; then
            read -r -p "  ${key} [${default:-required}]: " ans || { ans=""; eof=1; }
        else
            read -r -p "  ${key} current: ${label} — [Enter=keep | new value]: " ans || { ans=""; eof=1; }
        fi
        local chosen="${ans:-$current}"
        if [ "$fresh" = "1" ] && [ -z "$ans" ]; then chosen="$default"; fi
        if [ -z "$chosen" ] && [ "$required" = "R" ]; then
            pwarn "$key is required — cannot be empty."
            if [ -n "$default" ]; then
                gen_out=$(generate_for "$key" "$default")
                chosen="${gen_out:-$default}"
            fi
            if [ -z "$chosen" ]; then
                if [ "$eof" = "1" ]; then break; fi
                continue
            fi
        fi
        if [ -n "$chosen" ] && ! validate_value "$type" "$chosen"; then
            pwarn "invalid value for $type: $chosen"
            if [ "$eof" = "1" ]; then break; fi
            continue
        fi
        break
    done
    echo "$chosen"
}

walk_section() {
    local group=$1 section=$2
    CURRENT_GROUP="$group"
    echo ""
    print_step "$group  ($section)"
    ensure_config_toml "$section"
}

VAR_SPECS=(
  "Core & Network|[core]|PUBLIC_IP|str||live_ip"
  "Core & Network|[core]|TAILSCALE_IP|str||"
  "Core & Network|[core]|REMOTE_WORKERS_ENABLED|bool||false"
  "Core & Network|[core]|POSTGRES_PORT_EXTERNAL|port||5432"
  "Core & Network|[core]|POSTGRES_PORT|port||5432"
  "Core & Network|[core]|POSTGRES_HOST|str||database"
  "Core & Network|[core]|POSTGRES_HOST_AUTH_METHOD|str||md5"
  "Core & Network|[core]|POSTGRES_DB|str||cmsdb"
  "Core & Network|[core]|POSTGRES_USER|str||cmsuser"
  "Core & Network|[core]|POSTGRES_PASSWORD|secret||rand_pw"
  "Core & Network|[core]|CMS_SECRET_KEY|secret||hex32"
  "Core & Network|[core]|CMS_DOMAIN|str||cms.local"
  "Core & Network|[core]|CMS_CONFIG|str||/usr/local/etc/cms.toml"
  "Core & Network|[core]|CMS_LOG_DIR|str||/var/local/log/cms"
  "Core & Network|[core]|CMS_CACHE_DIR|str||/var/local/cache/cms"
  "Core & Network|[core]|CMS_DATA_DIR|str||/var/local/lib/cms"
  "Core & Network|[core]|APT_MIRROR|str||archive.ubuntu.com"
  "Core & Network|[core]|IMG_TAG|str||major-admin-panel"
  "Core & Network|[core]|LOG_SERVICE_SHARD|num||0"
  "Core & Network|[core]|RESOURCE_SERVICE_SHARD|num||0"
  "Core & Network|[core]|SCORING_SERVICE_SHARD|num||0"
  "Core & Network|[core]|EVALUATION_SERVICE_SHARD|num||0"
  "Core & Network|[core]|PROXY_SERVICE_SHARD|num||0"
  "Core & Network|[core]|CHECKER_SERVICE_SHARD|num||0"
  "Admin Panel|[admin]|DEPLOYMENT_TYPE|enum:img,src||img"
  "Admin Panel|[admin]|ADMIN_NEXT_PORT_EXTERNAL|port||8891"
  "Admin Panel|[admin]|ADMIN_PORT_EXTERNAL|port||8889"
  "Admin Panel|[admin]|ADMIN_LISTEN_ADDRESS|str||0.0.0.0"
  "Admin Panel|[admin]|ADMIN_LISTEN_PORT|port||8889"
  "Admin Panel|[admin]|ADMIN_DOMAIN|str||admin.cms.local"
  "Admin Panel|[admin]|ADMIN_NEXT_DOMAIN|str||admin-next.cms.local"
  "Admin Panel|[admin]|RANKING_PORT_EXTERNAL|port||8890"
  "Admin Panel|[admin]|RANKING_LISTEN_ADDRESS|str||0.0.0.0"
  "Admin Panel|[admin]|RANKING_LISTEN_PORT|port||8890"
  "Admin Panel|[admin]|RANKING_DOMAIN|str||ranking.cms.local"
  "Admin Panel|[admin]|RANKING_USERNAME|str||admin"
  "Admin Panel|[admin]|RANKING_PASSWORD|secret||"
  "Admin Panel|[admin]|ADMIN_COOKIE_DURATION|num||36000"
  "Admin Panel|[admin]|AUTH_SECRET|secret||hex32"
  "Admin Panel|[admin]|SERVER_BASE_URL|url||http://localhost"
  "Admin Panel|[admin]|VITE_API_URL|url||http://localhost:8889"
  "Admin Panel|[admin]|CAPTCHA_ENABLED|enum:0,1||0"
  "Admin Panel|[admin]|PER_USER_LIMIT|num||1"
  "Admin Panel|[admin]|REDIS_HOST|str||redis-rate-limit"
  "Admin Panel|[admin]|REDIS_PORT|port||6379"
  "Admin Panel|[admin]|REDIS_RATE_LIMIT|num||0"
  "Admin Panel|[admin]|SOCKET_PROXY|enum:0,1||0"
  "Admin Panel|[admin]|MONITOR_ENHANCED|enum:0,1||0"
  "Admin Panel|[admin]|CMS_RANKING_LOG_DIR|str||/var/local/log/cms/ranking"
  "Admin Panel|[admin]|CMS_RANKING_LIB_DIR|str||/var/local/lib/cms/ranking"
  "Contest|[contest]|CONTEST_ID|num||1"
  "Contest|[contest]|CONTEST_DOMAIN|str||cms.local"
  "Contest|[contest]|CONTEST_LISTEN_PORT|port||8888"
  "Contest|[contest]|CONTEST_LISTEN_ADDRESS|str||0.0.0.0"
  "Contest|[contest]|ACTIVE_CONTEST_PORT|port||8888"
  "Contest|[contest]|SECRET_KEY|secret||hex32"
  "Contest|[contest]|COOKIE_DURATION|num||10800"
  "Contest|[contest]|ACCESS_METHOD|enum:public_port,domain||public_port"
  "Contest|[contest]|NUM_PROXIES_USED|num||1"
  "Contest|[contest]|MAX_SUBMISSION_LENGTH|num||100000"
  "Contest|[contest]|MAX_INPUT_LENGTH|num||5000000"
  "Contest|[contest]|SUBMIT_LOCAL_COPY|bool||true"
  "Contest|[contest]|CONTEST_WEB_CPU_LIMIT|str||2"
  "Contest|[contest]|CONTEST_WEB_MEMORY_LIMIT|str||2G"
  "Contest|[contest]|ENABLE_TLS|bool||false"
  "Worker|[worker]|CORE_SERVICES_HOST|str||mirror_public_ip"
  "Worker|[worker]|WORKER_SHARD|num||0"
  "Worker|[worker]|WORKER_NAME|str||worker-0"
  "Worker|[worker]|WORKER_PORT|port||26000"
  "Worker|[worker]|WORKER_REPLICAS|num||1"
  "Worker|[worker]|WORKER_CPU_LIMIT|str||2"
  "Worker|[worker]|WORKER_MEMORY_LIMIT|str||2G"
  "Worker|[worker]|WORKER_CPU_RESERVATION|str||1"
  "Worker|[worker]|WORKER_MEMORY_RESERVATION|str||1G"
  "Worker|[worker]|ISOLATE_CGROUP_CONTROL|enum:0,1||1"
  "Worker|[worker]|ISOLATE_CGROUP_PATH|str||/sys/fs/cgroup/cms-isolate"
  "Worker|[worker]|KEEP_SANDBOX|bool||false"
  "Worker|[worker]|MAX_FILE_SIZE|num||1048576"
  "Infra & Monitoring|[infra]|DISCORD_WEBHOOK_URL|url||"
  "Infra & Monitoring|[infra]|DISCORD_ROLE_ID|str||"
  "Infra & Monitoring|[infra]|MONITOR_CPU_THRESHOLD|num||80"
  "Infra & Monitoring|[infra]|MONITOR_MEM_THRESHOLD|num||80"
  "Infra & Monitoring|[infra]|MONITOR_DISK_THRESHOLD|num||80"
  "Infra & Monitoring|[infra]|MONITOR_INTERVAL|num||10"
  "Infra & Monitoring|[infra]|MONITOR_COOLDOWN|num||300"
  "Infra & Monitoring|[infra]|DOCKER_GID|num||docker_gid"
  "Infra & Monitoring|[infra]|DISK_PATH|str||/host"
  "Infra & Monitoring|[infra]|BACKUP_INTERVAL_MINS|num||1440"
  "Infra & Monitoring|[infra]|BACKUP_MAX_COUNT|num||50"
  "Infra & Monitoring|[infra]|BACKUP_MAX_AGE_DAYS|num||10"
  "Infra & Monitoring|[infra]|BACKUP_MAX_SIZE_GB|num||5"
  "Admin Panel|[admin]|DOMAIN_NAME|str||cms.local"
  "Admin Panel|[admin]|DOMAIN_CERT_METHOD|str||letsencrypt"
  "Admin Panel|[admin]|HSTS_MAX_AGE|num||300"
  "Infra & Monitoring|[infra]|OFFSITE_TAILNET_NODE|str||"
  "Infra & Monitoring|[infra]|OFFSITE_ENCRYPT_KEY|secret||"
  "Infra & Monitoring|[infra]|OFFSITE_BACKUP_PATH|str||/var/local/backups/cms"
  "Admin Panel|[admin]|SOCKET_PROXY|enum:0,1||0"
  "Admin Panel|[admin]|MONITOR_ENHANCED|enum:0,1||0"
  "Admin Panel|[admin]|REDIS_HOST|str||redis-rate-limit"
  "Admin Panel|[admin]|REDIS_PORT|port||6379"
  "Admin Panel|[admin]|REDIS_RATE_LIMIT|num||0"
  "Admin Panel|[admin]|PER_USER_LIMIT|num||1"
  "Infra & Monitoring|[infra]|MONITORING_ENABLED|enum:0,1||0"
  "Infra & Monitoring|[infra]|PROMETHEUS_PORT|port||9090"
  "Infra & Monitoring|[infra]|PROMETHEUS_BIND_IP|str||127.0.0.1"
  "Infra & Monitoring|[infra]|GRAFANA_PORT|port||3001"
  "Infra & Monitoring|[infra]|GRAFANA_BIND_IP|str||127.0.0.1"
  "Infra & Monitoring|[infra]|GRAFANA_ADMIN_USER|str||admin"
  "Infra & Monitoring|[infra]|GRAFANA_PASSWORD|secret||admin"
  "Infra & Monitoring|[infra]|GRAFANA_ROOT_URL|url||http://localhost:3001/"
  "Core & Network|[core]|TAILSCALE_IP|str||127.0.0.1"
  "Infra & Monitoring|[infra]|CAA_ENABLED|enum:0,1||0"
  "Infra & Monitoring|[infra]|CAA_ISSUER|str||letsencrypt.org"
  "Infra & Monitoring|[infra]|DNSSEC_ENABLED|enum:0,1||0"
  "Infra & Monitoring|[infra]|HSM_ENABLED|enum:0,1||0"
  "Infra & Monitoring|[infra]|HSM_KEY_LABEL|str||grader-privkey"
  "Infra & Monitoring|[infra]|HSM_MODULE|str||softhsm"
  "Infra & Monitoring|[infra]|HSM_PIN|secret||"
  "Core & Network|[core]|MTLS_CA_CERT|str||config/mtls/ca.pem"
  "Core & Network|[core]|MTLS_WORKER_CERT|str||config/mtls/worker.pem"
  "Core & Network|[core]|MTLS_WORKER_KEY|str||config/mtls/worker-key.pem"
  "Infra & Monitoring|[infra]|MTLS_WORKERS_ENABLED|enum:0,1||0"
  "Infra & Monitoring|[infra]|VAULT_ADDR|url||http://vault:8200"
  "Infra & Monitoring|[infra]|VAULT_ENABLED|enum:0,1||0"
  "Infra & Monitoring|[infra]|VAULT_PATH|str||secret/cms"
  "Infra & Monitoring|[infra]|VAULT_TOKEN|secret||"
  "Infra & Monitoring|[infra]|WAF_ANOMALY_INBOUND|num||5"
  "Infra & Monitoring|[infra]|WAF_ANOMALY_OUTBOUND|num||4"
  "Infra & Monitoring|[infra]|WAF_BIND_IP|str||127.0.0.1"
  "Infra & Monitoring|[infra]|WAF_ENABLED|enum:0,1||0"
  "Infra & Monitoring|[infra]|WAF_PARANOIA|num||1"
  "Infra & Monitoring|[infra]|WAF_PORT|port||8080"
  "Infra & Monitoring|[infra]|WAF_RULE_ENGINE|str||DetectionOnly"
)

needs_fix() {
    local section=$1 key=$2 type=$3 required=$4
    local current
    current=$(get_var "$section" "$key")
    if [ -z "$current" ]; then
        [ "$required" = "R" ] && return 0
        return 1
    fi
    if is_secret_key "$key" && is_default_secret "$current"; then return 0; fi
    validate_value "$type" "$current" || return 0
    return 1
}

run_fix_mode() {
    print_step "Fix Mode (non-interactive)"
    local unfixable=0 last_group=""
    for spec in "${VAR_SPECS[@]}"; do
        IFS='|' read -r group section key type required default <<<"$spec"
        if [[ "$group" != "$last_group" ]]; then
            echo ""
            print_step "$group  ($section)"
            last_group="$group"
            CURRENT_GROUP="$group"
        fi
        needs_fix "$section" "$key" "$type" "$required" || { record_stat "$group" kept; continue; }
        local newval
        newval=$(generate_for "$key" "$default")
        if [ -z "$newval" ]; then
            newval="$default"
        fi
        if [ -z "$newval" ]; then
            print_error "$key ($section): unfixable — no generator and no default"
            unfixable=1
            continue
        fi
        if ! validate_value "$type" "$newval"; then
            print_error "$key ($section): generated value failed validation: $newval"
            unfixable=1
            continue
        fi
        apply_var "$section" "$key" "$newval" generated
    done
    if [ "$unfixable" -eq 0 ]; then
        configure_ranking_auth
    fi
    print_summary
    exit $unfixable
}

print_summary() {
    echo ""
    echo "================= UPDATE SUMMARY ================="
    printf '  %-14s %s\n' "changed:"   "$COUNT_CHANGED"
    printf '  %-14s %s\n' "kept:"      "$COUNT_KEPT"
    printf '  %-14s %s\n' "generated:" "$COUNT_GENERATED"
    echo "--------------------------------------------------"
    local seen="" group
    while IFS= read -r row; do
        [ -z "$row" ] && continue
        group="${row%%|*}"
        if [[ ",$seen," != *",$group,"* ]]; then
            seen="${seen}${seen:+,}$group"
            local c=0 k=0 g=0 r
            while IFS= read -r r; do
                [[ "${r%%|*}" == "$group" ]] || continue
                case "${r#*|}" in changed) c=$((c+1));; kept) k=$((k+1));; generated) g=$((g+1));; esac
            done <<<"$GROUP_STATS"
            printf '  %-24s changed:%-3s kept:%-3s generated:%-3s\n' "$group" "$c" "$k" "$g"
        fi
    done <<<"$GROUP_STATS"
    echo "=================================================="
}

if [ "$MODE" = "update-server" ]; then
    run_update_mode
fi

if [ "$MODE" = "fix" ]; then
    run_fix_mode
fi

FRESH=0
[ "$MODE" = "fresh" ] && FRESH=1

echo ""
echo "==============================================="
if [ "$FRESH" -eq 1 ]; then
    echo " CMS configuration — fresh setup walk"
else
    echo " CMS configuration — update wizard"
fi
echo "==============================================="
[ -t 0 ] || print_warning "stdin is not a tty — answers will be read from input stream."

if [ "$DRY_RUN" = "true" ]; then
    echo ""
    print_step "Variable overview (dry-run) — no writes will occur"
    show_vars_table
    echo ""
fi

if declare -F tui::tty_ok >/dev/null 2>&1 && tui::tty_ok 2>/dev/null && [ "$MODE" != "fix" ] && [ "$DRY_RUN" != "true" ]; then
    run_tui_vars_wizard
else
    if [ "$DRY_RUN" != "true" ] && [ "$MODE" != "fix" ]; then
        echo ""
        print_step "Variable overview — confirm each var before any write"
        show_vars_table
        echo ""
        print_info "You will be asked per-var: [e]dit / [k]eep / [c]onfirm — bulk 'a' not yet, answer each."
        echo ""
    fi
    LAST_GROUP=""
    for spec in "${VAR_SPECS[@]}"; do
        IFS='|' read -r group section key type required default <<<"$spec"
        if [[ "$group" != "$LAST_GROUP" ]]; then
            walk_section "$group" "$section"
            LAST_GROUP="$group"
        fi
        newval=$(ask_var "$section" "$key" "$type" "$required" "$default" "$FRESH")
        cur_val=$(get_var "$section" "$key")
        if [ "$newval" = "$cur_val" ] && [ "$FRESH" -eq 0 ]; then
            record_stat "$group" kept
            continue
        fi
        apply_var "$section" "$key" "$newval" changed
    done
fi

configure_ranking_auth
print_summary
