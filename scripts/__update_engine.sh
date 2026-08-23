#!/usr/bin/env bash
# __update_engine.sh — configuration update engine for CMS Docker.
#
# Modes:
#   (none)   Interactive section walk over all managed variables.
#   --fix    Non-interactive: regenerate ONLY missing/invalid required vars.
#   --fresh  Full first-time walk: every var written, defaults offered instead
#            of keeping current values.
#
# Helpers are ported from scripts/setup.sh (which stays untouched).
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
MODE="walk"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --fix)     MODE="fix" ;;
    --fresh)   MODE="fresh" ;;
    --update-server) MODE="update-server" ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) log_die "unknown option: $arg (use: --fix | --fresh | --dry-run)" 2 ;;
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
    awk -F= -v k="$key" '$1==k { v=$0; sub(/^[^=]*=/, "", v); print v; exit }' "$file" 2>/dev/null | tr -d '\r' || true
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
    local file=$1 key=$2 type=$3 required=$4 default=$5 fresh=$6
    local current
    current=$(get_var "$file" "$key")
    local label
    label=$(mask_show "$key" "$current")
    local ans chosen gen_out eof=0

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
                *) print_warning "invalid choice"; continue ;;
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
            print_warning "$key is required — cannot be empty."
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
            print_warning "invalid value for $type: $chosen"
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
  "Core & Network|.env.core|PUBLIC_IP|str|R|live_ip"
  "Core & Network|.env.core|TAILSCALE_IP|str||"
  "Core & Network|.env.core|REMOTE_WORKERS_ENABLED|bool||false"
  "Core & Network|.env.core|POSTGRES_PORT_EXTERNAL|port||5432"
  "Core & Network|.env.core|POSTGRES_USER|str||cmsuser"
  "Core & Network|.env.core|POSTGRES_PASSWORD|secret|R|rand_pw"
  "Core & Network|.env.core|CMS_SECRET_KEY|secret|R|hex32"
  "Admin Panel|.env.admin|DEPLOYMENT_TYPE|enum:img,src||img"
  "Admin Panel|.env.admin|ADMIN_NEXT_PORT_EXTERNAL|port||8891"
  "Admin Panel|.env.admin|ADMIN_PORT_EXTERNAL|port||8889"
  "Admin Panel|.env.admin|RANKING_PORT_EXTERNAL|port||8890"
  "Admin Panel|.env.admin|ADMIN_COOKIE_DURATION|num||36000"
  "Admin Panel|.env.admin|AUTH_SECRET|secret|R|hex32"
  "Contest|.env.contest|CONTEST_ID|num|R|1"
  "Contest|.env.contest|CONTEST_LISTEN_PORT|port||8888"
  "Contest|.env.contest|SECRET_KEY|secret|R|hex32"
  "Contest|.env.contest|COOKIE_DURATION|num||10800"
  "Contest|.env.contest|ACCESS_METHOD|enum:public_port,domain||public_port"
  "Worker|.env.worker|CORE_SERVICES_HOST|str|R|mirror_public_ip"
  "Worker|.env.worker|WORKER_SHARD|num||0"
  "Worker|.env.worker|WORKER_REPLICAS|num||1"
  "Worker|.env.worker|WORKER_CPU_LIMIT|str||2"
  "Worker|.env.worker|WORKER_MEMORY_LIMIT|str||2G"
  "Infra & Monitoring|.env.infra|DISCORD_WEBHOOK_URL|url||"
  "Infra & Monitoring|.env.infra|DISCORD_ROLE_ID|str||"
  "Infra & Monitoring|.env.infra|MONITOR_CPU_THRESHOLD|num||80"
  "Infra & Monitoring|.env.infra|MONITOR_MEM_THRESHOLD|num||80"
  "Infra & Monitoring|.env.infra|MONITOR_DISK_THRESHOLD|num||80"
  "Infra & Monitoring|.env.infra|MONITOR_INTERVAL|num||10"
  "Infra & Monitoring|.env.infra|MONITOR_COOLDOWN|num||300"
  "Infra & Monitoring|.env.infra|DOCKER_GID|num||docker_gid"
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

LAST_SECTION=""
for spec in "${VAR_SPECS[@]}"; do
    IFS='|' read -r section file key type required default <<<"$spec"
    if [[ "$section" != "$LAST_SECTION" ]]; then
        walk_section "$section" "$file"
        LAST_SECTION="$section"
    fi
    cur_val=$(get_var "$file" "$key")
    newval=$(prompt_var "$file" "$key" "$type" "$required" "$default" "$FRESH")
    if [ "$newval" == "$cur_val" ] && [ "$FRESH" -eq 0 ]; then
        record_stat "$section" kept
        continue
    fi
    apply_var "$file" "$key" "$newval" changed
done

configure_ranking_auth
print_summary
