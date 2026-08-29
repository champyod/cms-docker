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
set -euo pipefail

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
  case "$v" in cmspassword|usern4me|passw0rd|DEFAULT_SECRET_KEY|admin) return 0 ;; esac
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

update_env_var() {
    local file=$1
    local key=$2
    local value=$3

    if [ ! -f "$file" ]; then
        echo "${key}=${value}" > "$file"
        return
    fi

    if grep -q "^${key}=" "$file"; then
        local escaped_val=$(echo "$value" | sed 's/[&/]/\\&/g')
        sed -i "s|^${key}=.*|${key}=${escaped_val}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

write_or_print() {
    local file="$1"
    shift
    if [ "$DRY_RUN" = "true" ]; then
        echo "---- DRY-RUN: Would write $file ----"
        cat -
        echo "---- DRY-RUN: End $file ----"
    else
        cat - > "$file"
    fi
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

    existing_ranking_username=$(get_var .env.contest RANKING_USERNAME)
    if [ -z "$existing_ranking_username" ]; then
        existing_ranking_username=$(get_var .env.admin RANKING_USERNAME)
    fi
    existing_ranking_password=$(get_var .env.contest RANKING_PASSWORD)
    if [ -z "$existing_ranking_password" ]; then
        existing_ranking_password=$(get_var .env.admin RANKING_PASSWORD)
    fi

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
        echo "DRY-RUN: Would update .env.contest: RANKING_USERNAME=$RANKING_USERNAME_INPUT"
        echo "DRY-RUN: Would update .env.contest: RANKING_PASSWORD=<hidden>"
        echo "DRY-RUN: Would run: make env"
        echo "DRY-RUN: Would run: ./scripts/__inject_config.sh"
        return
    fi

    update_env_var .env.contest "RANKING_USERNAME" "$RANKING_USERNAME_INPUT"
    update_env_var .env.contest "RANKING_PASSWORD" "$RANKING_PASSWORD_INPUT"
    propagate_generated
    print_success "Ranking credentials updated in .env.contest, .env, config/cms.toml, and config/cms_ranking.toml"
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

ensure_env_file() {
    local file=$1
    local example="${file}.example"
    if [ ! -f "$file" ] && [ -f "$example" ]; then
        if [ "$DRY_RUN" = "true" ]; then
            echo "DRY-RUN: Would template $file from $example"
        else
            cp "$example" "$file"
            print_info "Templated $file from $example"
        fi
    fi
}

get_var() {
    local file=$1 key=$2
    awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); sub(/[[:space:]]*#.*$/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
}

get_default_for() {
    local file=$1 key=$2
    local ex="${file}.example"
    [ -f "$ex" ] || return 0
    awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); sub(/[[:space:]]*#.*$/, "", v); gsub(/^[ \t]+|[ \t]+$/, "", v); print v; exit }' "$ex" 2>/dev/null | tr -d '\r' || true
}

get_status() {
    local file=$1 key=$2 current=$3 default_val=$4
    if [ -z "$current" ]; then echo "MISSING"; return; fi
    if is_default_secret "$current"; then echo "DEFAULT"; return; fi
    if [ -n "$default_val" ] && [ "$current" = "$default_val" ]; then echo "DEFAULT"; return; fi
    if [ -z "$default_val" ] && [ "$current" = "" ]; then echo "MISSING"; return; fi
    echo "CUSTOM"
}

show_vars_table() {
    local use_tui=0
    if declare -F tui::tty_ok >/dev/null 2>&1 && tui::tty_ok 2>/dev/null; then use_tui=1; fi
    local header="Var\tCurrent\tDefault\tStatus\tFile"
    local rows=""
    local spec section file key type required default_cur current defval status cur_disp def_disp
    for spec in "${VAR_SPECS[@]}"; do
        IFS='|' read -r section file key type required default_cur <<<"$spec"
        current=$(get_var "$file" "$key")
        defval=$(get_default_for "$file" "$key")
        [ -z "$defval" ] && defval="$default_cur"
        status=$(get_status "$file" "$key" "$current" "$defval")
        cur_disp=$(mask_show "$key" "$current")
        def_disp=$(mask_show "$key" "$defval")
        rows+="${key}\t${cur_disp}\t${def_disp}\t${status}\t${file}"$'\n'
    done
    if [ "$use_tui" = "1" ]; then
        { echo -e "$header"; echo -e "$rows"; } | tui::table
    else
        printf "%-28s %-22s %-22s %-10s %s\n" "Var" "Current" "Default" "Status" "File"
        printf "%-28s %-22s %-22s %-10s %s\n" "----------------------------" "----------------------" "----------------------" "----------" "--------------"
        while IFS=$'\t' read -r key cur def stat file; do
            [ -z "$key" ] && continue
            printf "%-28s %-22s %-22s %-10s %s\n" "$key" "$cur" "$def" "$stat" "$file"
        done <<<"$(echo -e "$rows")"
    fi
}

ask_var() {
    local file=$1 key=$2 type=$3 required=$4 default_spec=$5 fresh=$6
    local current default_val status cur_disp def_disp
    current=$(get_var "$file" "$key")
    default_val=$(get_default_for "$file" "$key")
    [ -z "$default_val" ] && default_val="$default_spec"
    status=$(get_status "$file" "$key" "$current" "$default_val")
    cur_disp=$(mask_show "$key" "$current")
    def_disp=$(mask_show "$key" "$default_val")
    if [ "$MODE" = "fix" ]; then
        needs_fix "$file" "$key" "$type" "$required" || { echo "$current"; return; }
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
        tui::panel "$key" "Current: $cur_disp" "Default: $def_disp" "Status: $status" "File: $file"
    else
        echo "  $key [current: $cur_disp] (default: $def_disp) Status: $status"
    fi
    prompt_var "$file" "$key" "$type" "$required" "$default_spec" "$fresh"
}

run_tui_vars_wizard() {
    local total=${#VAR_SPECS[@]}
    print_step "Interactive variable review — ${total} vars (j/k move, e edit, c keep, a apply all, q quit)"
    show_vars_table
    declare -A __pending
    local spec section file key type required default
    for spec in "${VAR_SPECS[@]}"; do
        IFS='|' read -r section file key type required default <<<"$spec"
        __pending["$key"]=$(get_var "$file" "$key")
    done
    while true; do
        echo ""
        local options=()
        for spec in "${VAR_SPECS[@]}"; do
            IFS='|' read -r section file key type required default <<<"$spec"
            local cur=$(get_var "$file" "$key")
            local def=$(get_default_for "$file" "$key"); [ -z "$def" ] && def="$default"
            local st=$(get_status "$file" "$key" "$cur" "$def")
            local cur_d
            cur_d=$(mask_show "$key" "$cur")
            options+=("${key} [${st}] ${cur_d} -> ${def} (${file})")
        done
        options+=(">>> APPLY ALL CONFIRMED <<<" ">>> QUIT WITHOUT SAVING <<<")
        local choice
        if ! choice=$(tui::choose "Select variable (j/k move, Enter act)" "${options[@]}"); then
            print_warning "Selection cancelled — staying in wizard."
            continue
        fi
        case "$choice" in
            ">>> APPLY ALL CONFIRMED <<<")
                if tui::confirm "Apply all confirmed values to .env.* files?"; then
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
                for spec in "${VAR_SPECS[@]}"; do
                    IFS='|' read -r section file key type required default <<<"$spec"
                    if [ "$key" = "$sel_key" ]; then
                        CURRENT_SECTION="$section"
                        ensure_env_file "$file"
                        local act
                        act=$(tui::choose "Action for $key ($file) — e edit / c keep / u default / q back" "e) edit value" "c) confirm keep" "u) update to default" "q) back") || break
                        case "$act" in
                            e* )
                                local newval
                                newval=$(prompt_var "$file" "$key" "$type" "$required" "$default" "$FRESH")
                                __pending["$key"]="$newval"
                                local cur0
                                cur0=$(get_var "$file" "$key")
                                if [ "$newval" = "$cur0" ] && [ "$FRESH" -eq 0 ]; then
                                    record_stat "$section" kept
                                else
                                    apply_var "$file" "$key" "$newval" changed
                                fi
                                ;;
                            c* )
                                record_stat "$section" kept
                                ;;
                            u* )
                                local def2
                                def2=$(get_default_for "$file" "$key"); [ -z "$def2" ] && def2="$default"
                                local gen
                                gen=$(generate_for "$key" "$default"); [ -z "$gen" ] && gen="$def2"
                                if [ -n "$gen" ]; then
                                    __pending["$key"]="$gen"
                                    apply_var "$file" "$key" "$gen" changed
                                else
                                    print_warning "No default/generator for $key — keeping current."
                                    record_stat "$section" kept
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
SECTION_STATS=""

record_stat() {
    local section=$1 kind=$2
    case "$kind" in
        changed)   COUNT_CHANGED=$((COUNT_CHANGED+1)) ;;
        kept)      COUNT_KEPT=$((COUNT_KEPT+1)) ;;
        generated) COUNT_GENERATED=$((COUNT_GENERATED+1)) ;;
    esac
    SECTION_STATS+="${section}|${kind}"$'\n'
}

apply_var() {
    local file=$1 key=$2 value=$3 kind=$4
    if [ "$DRY_RUN" = "true" ]; then
        echo "DRY-RUN: Would update $file: $(is_secret_key "$key" && echo "${key}=<hidden>" || echo "${key}=${value}") [$kind]"
    else
        update_env_var "$file" "$key" "$value"
        if is_secret_key "$key"; then
            print_success "$key: <hidden> [$kind]"
        else
            print_success "$key: ${value} [$kind]"
        fi
    fi
    record_stat "$CURRENT_SECTION" "$kind"
}

generate_for() {
    local key=$1 gen=$2
    case "$gen" in
        hex32)    gen_hex32 ;;
        rand_pw)  gen_pw ;;
        live_ip)  gen_live_ip ;;
        docker_gid) gen_docker_gid ;;
        mirror_public_ip) get_var .env.core PUBLIC_IP ;;
        *) echo "" ;;
    esac
}

# 10# prefix keeps leading-zero octets (e.g. 08) from parsing as octal.
_ip_octets_in_range() {
    local value=$1 octet
    IFS='.' read -r -a octets <<<"$value"
    for octet in "${octets[@]}"; do
        (( 10#$octet <= 255 )) || return 1
    done
}

validate_value() {
    local type=$1 value=$2
    case "$type" in
        port)     is_positive_int "$value" && [ "$value" -le 65535 ] ;;
        num)      case "$value" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac ;;
        bool)     [[ "$value" == "true" || "$value" == "false" ]] ;;
        enum:*)   local opts="${type#enum:}"; [[ ",$opts," == *",$value,"* ]] ;;
        url)      [[ -z "$value" || "$value" =~ ^https?://[^/[:space:]] ]] ;;
        ip)       [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] && _ip_octets_in_range "$value" ;;
        hostname) [[ "$value" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$ ]] ;;
        memory)   [[ "$value" =~ ^[0-9]+[MG]i?$ ]] ;;
        cpu)      [[ "$value" =~ ^[0-9]+(\.[0-9]+)?$ ]] ;;
        path)     [[ "$value" == /* ]] ;;
        str)      [[ -n "$value" ]] ;;
        *)        return 0 ;;
    esac
}

prompt_var() {
    local file=$1 key=$2 type=$3 required=$4 default=$5 fresh=$6
    local current
    current=$(get_var "$file" "$key")
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
    local title=$1 file=$2
    CURRENT_SECTION="$title"
    echo ""
    print_step "$title  ($file)"
    ensure_env_file "$file"
}

VAR_SPECS=(
  "Core & Network|.env.core|PUBLIC_IP|ip||live_ip"
  "Core & Network|.env.core|TAILSCALE_IP|ip||"
  "Core & Network|.env.core|REMOTE_WORKERS_ENABLED|bool||false"
  "Core & Network|.env.core|POSTGRES_PORT_EXTERNAL|port||5432"
  "Core & Network|.env.core|POSTGRES_PORT|port||5432"
  "Core & Network|.env.core|POSTGRES_HOST|str||database"
  "Core & Network|.env.core|POSTGRES_HOST_AUTH_METHOD|str||md5"
  "Core & Network|.env.core|POSTGRES_DB|str||cmsdb"
  "Core & Network|.env.core|POSTGRES_USER|str||cmsuser"
  "Core & Network|.env.core|POSTGRES_PASSWORD|secret|R|rand_pw"
  "Core & Network|.env.core|CMS_SECRET_KEY|secret|R|hex32"
  "Core & Network|.env.core|CMS_DOMAIN|hostname||cms.local"
  "Core & Network|.env.core|CMS_CONFIG|path||/usr/local/etc/cms.toml"
  "Core & Network|.env.core|CMS_LOG_DIR|path||/var/local/log/cms"
  "Core & Network|.env.core|CMS_CACHE_DIR|path||/var/local/cache/cms"
  "Core & Network|.env.core|CMS_DATA_DIR|path||/var/local/lib/cms"
  "Core & Network|.env.core|APT_MIRROR|str||archive.ubuntu.com"
  "Core & Network|.env.core|IMG_TAG|str||major-admin-panel"
  "Core & Network|.env.core|LOG_SERVICE_SHARD|num||0"
  "Core & Network|.env.core|RESOURCE_SERVICE_SHARD|num||0"
  "Core & Network|.env.core|SCORING_SERVICE_SHARD|num||0"
  "Core & Network|.env.core|EVALUATION_SERVICE_SHARD|num||0"
  "Core & Network|.env.core|PROXY_SERVICE_SHARD|num||0"
  "Core & Network|.env.core|CHECKER_SERVICE_SHARD|num||0"
  "Admin Panel|.env.admin|DEPLOYMENT_TYPE|enum:img,src||img"
  "Admin Panel|.env.admin|ADMIN_NEXT_PORT_EXTERNAL|port||8891"
  "Admin Panel|.env.admin|ADMIN_PORT_EXTERNAL|port||8889"
  "Admin Panel|.env.admin|ADMIN_LISTEN_ADDRESS|ip||0.0.0.0"
  "Admin Panel|.env.admin|ADMIN_LISTEN_PORT|port||8889"
  "Admin Panel|.env.admin|ADMIN_DOMAIN|str||admin.cms.local"
  "Admin Panel|.env.admin|ADMIN_NEXT_DOMAIN|str||admin-next.cms.local"
  "Admin Panel|.env.admin|RANKING_PORT_EXTERNAL|port||8890"
  "Admin Panel|.env.admin|RANKING_LISTEN_ADDRESS|ip||0.0.0.0"
  "Admin Panel|.env.admin|RANKING_LISTEN_PORT|port||8890"
  "Admin Panel|.env.admin|RANKING_DOMAIN|str||ranking.cms.local"
  "Admin Panel|.env.admin|RANKING_USERNAME|str||admin"
  "Admin Panel|.env.admin|RANKING_PASSWORD|secret|R|rand_pw"
  "Admin Panel|.env.admin|ADMIN_COOKIE_DURATION|num||36000"
  "Admin Panel|.env.admin|AUTH_SECRET|secret||hex32"
  "Admin Panel|.env.admin|SERVER_BASE_URL|url||http://localhost"
  "Admin Panel|.env.admin|VITE_API_URL|url||http://localhost:8889"
  "Admin Panel|.env.admin|CAPTCHA_ENABLED|enum:0,1||0"
  "Admin Panel|.env.admin|PER_USER_LIMIT|num||1"
  "Admin Panel|.env.admin|REDIS_HOST|str||redis-rate-limit"
  "Admin Panel|.env.admin|REDIS_PORT|port||6379"
  "Admin Panel|.env.admin|REDIS_RATE_LIMIT|num||0"
  "Admin Panel|.env.admin|SOCKET_PROXY|enum:0,1||0"
  "Admin Panel|.env.admin|MONITOR_ENHANCED|enum:0,1||0"
  "Admin Panel|.env.admin|CMS_RANKING_LOG_DIR|path||/var/local/log/cms/ranking"
  "Admin Panel|.env.admin|CMS_RANKING_LIB_DIR|path||/var/local/lib/cms/ranking"
  "Contest|.env.contest|CONTEST_ID|num||1"
  "Contest|.env.contest|CONTEST_DOMAIN|str||grader.mwit.ac.th"
  "Contest|.env.contest|CONTEST_LISTEN_PORT|port||8888"
  "Contest|.env.contest|CONTEST_LISTEN_ADDRESS|ip||0.0.0.0"
  "Contest|.env.contest|ACTIVE_CONTEST_PORT|port||8888"
  "Contest|.env.contest|SECRET_KEY|secret||hex32"
  "Contest|.env.contest|COOKIE_DURATION|num||10800"
  "Contest|.env.contest|ACCESS_METHOD|enum:public_port,domain||public_port"
  "Contest|.env.contest|NUM_PROXIES_USED|num||1"
  "Contest|.env.contest|MAX_SUBMISSION_LENGTH|num||100000"
  "Contest|.env.contest|MAX_INPUT_LENGTH|num||5000000"
  "Contest|.env.contest|SUBMIT_LOCAL_COPY|bool||true"
  "Contest|.env.contest|CONTEST_WEB_CPU_LIMIT|cpu||2"
  "Contest|.env.contest|CONTEST_WEB_MEMORY_LIMIT|memory||2G"
  "Contest|.env.contest|ENABLE_TLS|bool||false"
  "Worker|.env.worker|CORE_SERVICES_HOST|str||mirror_public_ip"
  "Worker|.env.worker|WORKER_SHARD|num||0"
  "Worker|.env.worker|WORKER_NAME|str||worker-0"
  "Worker|.env.worker|WORKER_PORT|port||26000"
  "Worker|.env.worker|WORKER_REPLICAS|num||1"
  "Worker|.env.worker|WORKER_CPU_LIMIT|cpu||2"
  "Worker|.env.worker|WORKER_MEMORY_LIMIT|memory||2G"
  "Worker|.env.worker|WORKER_CPU_RESERVATION|cpu||1"
  "Worker|.env.worker|WORKER_MEMORY_RESERVATION|memory||1G"
  "Worker|.env.worker|ISOLATE_CGROUP_CONTROL|enum:0,1||1"
  "Worker|.env.worker|ISOLATE_CGROUP_PATH|path||/sys/fs/cgroup/cms-isolate"
  "Worker|.env.worker|KEEP_SANDBOX|bool||false"
  "Worker|.env.worker|MAX_FILE_SIZE|num||1048576"
  "Infra & Monitoring|.env.infra|DISCORD_WEBHOOK_URL|url||"
  "Infra & Monitoring|.env.infra|DISCORD_ROLE_ID|str||"
  "Infra & Monitoring|.env.infra|MONITOR_CPU_THRESHOLD|num||80"
  "Infra & Monitoring|.env.infra|MONITOR_MEM_THRESHOLD|num||80"
  "Infra & Monitoring|.env.infra|MONITOR_DISK_THRESHOLD|num||80"
  "Infra & Monitoring|.env.infra|MONITOR_INTERVAL|num||10"
  "Infra & Monitoring|.env.infra|MONITOR_COOLDOWN|num||300"
  "Infra & Monitoring|.env.infra|DOCKER_GID|num||docker_gid"
  "Infra & Monitoring|.env.infra|DISK_PATH|path||/host"
  "Infra & Monitoring|.env.infra|BACKUP_INTERVAL_MINS|num||1440"
  "Infra & Monitoring|.env.infra|BACKUP_MAX_COUNT|num||50"
  "Infra & Monitoring|.env.infra|BACKUP_MAX_AGE_DAYS|num||10"
  "Infra & Monitoring|.env.infra|BACKUP_MAX_SIZE_GB|num||5"
  "Infra & Monitoring|.env.infra|DOMAIN_NAME|str||grader.mwit.ac.th"
  "Infra & Monitoring|.env.infra|DOMAIN_CERT_METHOD|enum:letsencrypt,provided,selfsigned||letsencrypt"
  "Infra & Monitoring|.env.infra|HSTS_MAX_AGE|num||300"
  "Infra & Monitoring|.env.infra|OFFSITE_TAILNET_NODE|str||100.75.203.112"
  "Infra & Monitoring|.env.infra|OFFSITE_ENCRYPT_KEY|secret|R|hex32"
  "Infra & Monitoring|.env.infra|OFFSITE_BACKUP_PATH|path||/var/local/backups/cms"
  "Infra & Monitoring|.env.infra|SOCKET_PROXY|enum:0,1||0"
  "Infra & Monitoring|.env.infra|MONITOR_ENHANCED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|REDIS_HOST|str||redis-rate-limit"
  "Infra & Monitoring|.env.infra|REDIS_PORT|port||6379"
  "Infra & Monitoring|.env.infra|REDIS_RATE_LIMIT|num||0"
  "Infra & Monitoring|.env.infra|PER_USER_LIMIT|num||1"
  "Infra & Monitoring|.env.infra|MONITORING_ENABLED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|PROMETHEUS_PORT|port||9090"
  "Infra & Monitoring|.env.infra|PROMETHEUS_BIND_IP|ip||127.0.0.1"
  "Infra & Monitoring|.env.infra|GRAFANA_PORT|port||3001"
  "Infra & Monitoring|.env.infra|GRAFANA_BIND_IP|ip||127.0.0.1"
  "Infra & Monitoring|.env.infra|GRAFANA_ADMIN_USER|str||admin"
  "Infra & Monitoring|.env.infra|GRAFANA_PASSWORD|secret||admin"
  "Infra & Monitoring|.env.infra|GRAFANA_ROOT_URL|url||http://localhost:3001/"
  "Infra & Monitoring|.env.infra|TAILSCALE_IP|ip||127.0.0.1"
  "Infra & Monitoring|.env.infra|CAA_ENABLED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|CAA_ISSUER|str||letsencrypt.org"
  "Infra & Monitoring|.env.infra|DNSSEC_ENABLED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|HSM_ENABLED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|HSM_KEY_LABEL|str||grader-privkey"
  "Infra & Monitoring|.env.infra|HSM_MODULE|enum:softhsm,yubihsm,cloudhsm||softhsm"
  "Infra & Monitoring|.env.infra|HSM_PIN|secret||"
  "Infra & Monitoring|.env.infra|MTLS_CA_CERT|str||config/mtls/ca.pem"
  "Infra & Monitoring|.env.infra|MTLS_WORKER_CERT|str||config/mtls/worker.pem"
  "Infra & Monitoring|.env.infra|MTLS_WORKER_KEY|str||config/mtls/worker-key.pem"
  "Infra & Monitoring|.env.infra|MTLS_WORKERS_ENABLED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|VAULT_ADDR|url||http://vault:8200"
  "Infra & Monitoring|.env.infra|VAULT_ENABLED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|VAULT_PATH|str||secret/cms"
  "Infra & Monitoring|.env.infra|VAULT_TOKEN|secret||"
  "Infra & Monitoring|.env.infra|WAF_ANOMALY_INBOUND|num||5"
  "Infra & Monitoring|.env.infra|WAF_ANOMALY_OUTBOUND|num||4"
  "Infra & Monitoring|.env.infra|WAF_BIND_IP|ip||127.0.0.1"
  "Infra & Monitoring|.env.infra|WAF_ENABLED|enum:0,1||0"
  "Infra & Monitoring|.env.infra|WAF_PARANOIA|num||1"
  "Infra & Monitoring|.env.infra|WAF_PORT|port||8080"
  "Infra & Monitoring|.env.infra|WAF_RULE_ENGINE|str||DetectionOnly"
)

needs_fix() {
    local file=$1 key=$2 type=$3 required=$4
    local current
    current=$(get_var "$file" "$key")
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
    local unfixable=0 last_section=""
    for spec in "${VAR_SPECS[@]}"; do
        IFS='|' read -r section file key type required default <<<"$spec"
        if [[ "$section" != "$last_section" ]]; then
            echo ""
            print_step "$section  ($file)"
            last_section="$section"
            CURRENT_SECTION="$section"
        fi
        needs_fix "$file" "$key" "$type" "$required" || { record_stat "$section" kept; continue; }
        local newval
        newval=$(generate_for "$key" "$default")
        if [ -z "$newval" ]; then
            newval="$default"
        fi
        if [ -z "$newval" ]; then
            print_error "$key ($file): unfixable — no generator and no default"
            unfixable=1
            continue
        fi
        if ! validate_value "$type" "$newval"; then
            print_error "$key ($file): generated value failed validation: $newval"
            unfixable=1
            continue
        fi
        apply_var "$file" "$key" "$newval" generated
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
    local seen="" sec kinds
    while IFS= read -r row; do
        [ -z "$row" ] && continue
        sec="${row%%|*}"; kinds="${row#*|}"
        if [[ ",$seen," != *",$sec,"* ]]; then
            seen="${seen}${seen:+,}$sec"
            local c=0 k=0 g=0 r
            while IFS= read -r r; do
                [[ "${r%%|*}" == "$sec" ]] || continue
                case "${r#*|}" in changed) c=$((c+1));; kept) k=$((k+1));; generated) g=$((g+1));; esac
            done <<<"$SECTION_STATS"
            printf '  %-24s changed:%-3s kept:%-3s generated:%-3s\n' "$sec" "$c" "$k" "$g"
        fi
    done <<<"$SECTION_STATS"
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
    LAST_SECTION=""
    for spec in "${VAR_SPECS[@]}"; do
        IFS='|' read -r section file key type required default <<<"$spec"
        if [[ "$section" != "$LAST_SECTION" ]]; then
            walk_section "$section" "$file"
            LAST_SECTION="$section"
        fi
        newval=$(ask_var "$file" "$key" "$type" "$required" "$default" "$FRESH")
        cur_val=$(get_var "$file" "$key")
        if [ "$newval" = "$cur_val" ] && [ "$FRESH" -eq 0 ]; then
            record_stat "$section" kept
            continue
        fi
        apply_var "$file" "$key" "$newval" changed
    done
fi

configure_ranking_auth
print_summary
