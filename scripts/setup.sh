#!/bin/bash

###############################################################################
# CMS Docker Comprehensive Setup Script
# Author: CCYod
# 
# This script automates the full deployment of CMS with orderly service recovery
# and configuration management. Supports fresh installs and updates.
###############################################################################

set -e

# Change directory to the project root (one level up from scripts/)
cd "$(dirname "$0")/.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Helpers
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }
print_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# CLI flags
DRY_RUN=false
UPDATE_ONLY=false
if [ "$1" = "--dry-run" ]; then
    DRY_RUN=true
    shift
    print_info "Running in dry-run mode: no files will be modified, no services started."
fi
if [ "$1" = "--update" ]; then
    UPDATE_ONLY=true
    shift
fi

# Update a variable in a .env file without destroying the file
update_env_var() {
    local file=$1
    local key=$2
    local value=$3
    
    if [ ! -f "$file" ]; then
        echo "${key}=${value}" > "$file"
        return
    fi

    if grep -q "^${key}=" "$file"; then
        # Handle cases where value might contain / or &
        local escaped_val=$(echo "$value" | sed 's/[&/]/\\&/g')
        sed -i "s|^${key}=.*|${key}=${escaped_val}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# Write or print helper (respects DRY_RUN)
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
    # Use bash's built-in /dev/tcp if available, otherwise try nc
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
    print_info "Using automated shard-aware update script (scripts/update-server.sh)..."
    
    chmod +x scripts/update-server.sh
    ./scripts/update-server.sh
    
    print_success "Update completed via update-server.sh."
    exit 0
}

configure_ranking_auth() {
    echo ""
    print_step "Contest & Ranking Authentication"

    local existing_ranking_username
    local existing_ranking_password

    existing_ranking_username=$(grep "^RANKING_USERNAME=" .env.contest 2>/dev/null | cut -d '=' -f2-)
    existing_ranking_password=$(grep "^RANKING_PASSWORD=" .env.contest 2>/dev/null | cut -d '=' -f2-)
    existing_ranking_username=${existing_ranking_username:-admin}
    existing_ranking_password=${existing_ranking_password:-adminpass}

    read -p "Ranking username [$existing_ranking_username]: " RANKING_USERNAME_INPUT
    RANKING_USERNAME_INPUT=${RANKING_USERNAME_INPUT:-$existing_ranking_username}

    read -s -p "Ranking password [hidden, leave blank to keep current]: " RANKING_PASSWORD_INPUT
    echo ""
    if [ -z "$RANKING_PASSWORD_INPUT" ]; then
        RANKING_PASSWORD_INPUT=$existing_ranking_password
    fi

    if [ "$DRY_RUN" = "true" ]; then
        echo "DRY-RUN: Would update .env.contest: RANKING_USERNAME=$RANKING_USERNAME_INPUT"
        echo "DRY-RUN: Would update .env.contest: RANKING_PASSWORD=<hidden>"
        echo "DRY-RUN: Would run: make env"
        echo "DRY-RUN: Would run: ./scripts/inject_config.sh"
        return
    fi

    update_env_var .env.contest "RANKING_USERNAME" "$RANKING_USERNAME_INPUT"
    update_env_var .env.contest "RANKING_PASSWORD" "$RANKING_PASSWORD_INPUT"
    make env
    ./scripts/inject_config.sh
    print_success "Ranking credentials updated in .env.contest, .env, config/cms.toml, and config/cms_ranking.toml"
}

if [ "$UPDATE_ONLY" = "true" ]; then
    run_update_mode
fi

# Banner
clear
echo -e "${CYAN}"
cat << "EOF"
  ____ __  __ ____    ____             _             
 / ___|  \/  / ___|  |  _ \  ___   ___| | _____ _ __ 
| |   | |\/| \___ \  | | | |/ _ \ / __| |/ / _ \ '__|
| |___| |  | |___) | | |_| | (_) | (__|   <  __/ |   
 \____|_|  |_|____/  |____/ \___/ \___|_|\_\___|_|   

          Modern Deployment & Management
               made by CCYod MWIT34
EOF
echo -e "${NC}"

# Check prerequisites
# ... (rest of prerequisites same)

# 0. Detection & Update Logic
IS_UPDATE=false
if [ -f .env.core ]; then
    IS_UPDATE=true
    print_warning "Existing configuration (.env.core) detected. Switching to UPDATE mode."
    
    # Load existing variables
    DETECTED_DB_PASS=$(grep "^POSTGRES_PASSWORD=" .env.core | cut -d '=' -f2-)
    SAVED_PUBLIC_IP=$(grep "^PUBLIC_IP=" .env.core | cut -d '=' -f2-)
    DETECTED_TAILSCALE_IP=$(grep "^TAILSCALE_IP=" .env.core | cut -d '=' -f2-)
    
    # Check .env.admin, .env.core, or .env.worker for DEPLOYMENT_TYPE
    DETECTED_DEPLOY_TYPE=$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2-)
    [ -z "$DETECTED_DEPLOY_TYPE" ] && DETECTED_DEPLOY_TYPE=$(grep "^DEPLOYMENT_TYPE=" .env.core 2>/dev/null | cut -d '=' -f2-)
    [ -z "$DETECTED_DEPLOY_TYPE" ] && DETECTED_DEPLOY_TYPE=$(grep "^DEPLOYMENT_TYPE=" .env.worker 2>/dev/null | cut -d '=' -f2-)
    
    # Fallback: Check running containers if DEPLOYMENT_TYPE is missing
    if [ -z "$DETECTED_DEPLOY_TYPE" ]; then
        if docker ps --format '{{.Image}}' | grep -q "ghcr.io/champyod"; then
            DETECTED_DEPLOY_TYPE="img"
        else
            DETECTED_DEPLOY_TYPE="src"
        fi
    fi
    
    print_info "Detected Public IP: $SAVED_PUBLIC_IP"
    print_info "Detected Strategy: $([ "$DETECTED_DEPLOY_TYPE" = "img" ] && echo "Pre-built Images" || echo "Source Build")"
fi

# 1. Setup Type
echo ""
print_step "Setup Type"
echo "What kind of node are you setting up?"
echo "1) MAIN SERVER (DB, Log, Admin, Contest, etc.)"
echo "2) REMOTE WORKER (Evaluation node only)"
read -p "Select type [1]: " SETUP_TYPE_CHOICE
SETUP_TYPE_CHOICE=${SETUP_TYPE_CHOICE:-1}

if [ "$SETUP_TYPE_CHOICE" = "2" ]; then
    SETUP_TYPE="worker"
    print_info "Configuring as Remote Worker."
else
    SETUP_TYPE="main"
    print_info "Configuring as Main Server."
fi

WORKER_SETUP_MODE=""
WORKER_INSTANCE_COUNT=1
WORKER_BASE_PORT=26000
WORKER_REGISTER_HOST="RESERVED"
WORKER_AUTO_START="y"
WORKER_MEMORY_LIMIT="2G"
WORKER_CPU_LIMIT="2"
WORKER_MEMORY_RESERVATION="1G"
WORKER_CPU_RESERVATION="1"
REMOTE_DB_HOST=""
REMOTE_DB_PORT="5432"
REMOTE_DB_NAME="cmsdb"
REMOTE_DB_USER="cmsuser"
REMOTE_DB_PASSWORD=""
RANKING_USERNAME_INPUT=""
RANKING_PASSWORD_INPUT=""

if [ "$SETUP_TYPE" = "worker" ]; then
    echo ""
    print_step "Worker Setup Mode"
    echo "1) WORKER CLIENT (run worker containers)"
    echo "2) WORKER MOUNTING (register WORKER_N in .env.core)"
    read -p "Select worker mode [1]: " WORKER_MODE_CHOICE
    WORKER_MODE_CHOICE=${WORKER_MODE_CHOICE:-1}
    if [ "$WORKER_MODE_CHOICE" = "2" ]; then
        WORKER_SETUP_MODE="mounting"
    else
        WORKER_SETUP_MODE="client"
    fi

    existing_worker_count=$(grep "^WORKER_INSTANCE_COUNT=" .env.worker 2>/dev/null | cut -d '=' -f2-)
    WORKER_INSTANCE_COUNT=${existing_worker_count:-1}
    read -p "How many worker instances? [$WORKER_INSTANCE_COUNT]: " WORKER_INSTANCE_COUNT_INPUT
    WORKER_INSTANCE_COUNT=${WORKER_INSTANCE_COUNT_INPUT:-$WORKER_INSTANCE_COUNT}
    if ! is_positive_int "$WORKER_INSTANCE_COUNT"; then
        print_error "Worker instance count must be a positive integer."
        exit 1
    fi
    # Save the count for next time
    update_env_var .env.worker "WORKER_INSTANCE_COUNT" "$WORKER_INSTANCE_COUNT"

    existing_base_port=$(grep "^WORKER_BASE_PORT=" .env.worker 2>/dev/null | cut -d '=' -f2-)
    WORKER_BASE_PORT=${existing_base_port:-26000}
    read -p "Base worker port (ports = base + idx) [$WORKER_BASE_PORT]: " WORKER_BASE_PORT_INPUT
    WORKER_BASE_PORT=${WORKER_BASE_PORT_INPUT:-$WORKER_BASE_PORT}
    if ! is_positive_int "$WORKER_BASE_PORT"; then
        print_error "Base worker port must be a positive integer."
        exit 1
    fi
    update_env_var .env.worker "WORKER_BASE_PORT" "$WORKER_BASE_PORT"

    if [ "$WORKER_SETUP_MODE" = "client" ]; then
        read -p "Auto-start worker containers after config? (y/n) [y]: " WORKER_AUTO_START
        WORKER_AUTO_START=${WORKER_AUTO_START:-y}
    else
        read -p "Worker host/IP for registration [RESERVED]: " WORKER_REGISTER_HOST
        WORKER_REGISTER_HOST=${WORKER_REGISTER_HOST:-RESERVED}
    fi
fi

# 2. Deployment Strategy
echo ""
print_step "Deployment Strategy"
if [ "$IS_UPDATE" = "true" ]; then
    echo "Current strategy is: $([ "$DETECTED_DEPLOY_TYPE" = "img" ] && echo "Pre-built Images" || echo "Source Build")"
    read -p "Keep existing strategy? (y/n) [y]: " KEEP_STRAT
    KEEP_STRAT=${KEEP_STRAT:-y}
    if [ "$KEEP_STRAT" = "y" ]; then
        DEPLOY_TYPE=$DETECTED_DEPLOY_TYPE
    else
        echo "1) PRE-BUILT IMAGES"
        echo "2) BUILD FROM SOURCE"
        read -p "Select new strategy [1]: " STRATEGY_CHOICE
        STRATEGY_CHOICE=${STRATEGY_CHOICE:-1}
        DEPLOY_TYPE=$([ "$STRATEGY_CHOICE" = "1" ] && echo "img" || echo "src")
    fi
else
    echo "How would you like to deploy CMS?"
    echo "1) PRE-BUILT IMAGES (Fastest, recommended for production)"
    echo "2) BUILD FROM SOURCE (Allows custom code changes, takes longer)"
    read -p "Select strategy [1]: " STRATEGY_CHOICE
    STRATEGY_CHOICE=${STRATEGY_CHOICE:-1}
    DEPLOY_TYPE=$([ "$STRATEGY_CHOICE" = "1" ] && echo "img" || echo "src")
fi

# 3. Network & Security Configuration
echo ""
print_step "Network & Security"
if [ "$SETUP_TYPE" = "main" ]; then
    LIVE_IP=$(curl -s -4 ifconfig.me || echo "127.0.0.1")
    if [ "$IS_UPDATE" = "true" ]; then
        print_info "Current saved IP: $SAVED_PUBLIC_IP"
        if [ "$SAVED_PUBLIC_IP" != "$LIVE_IP" ]; then
            print_warning "Your live detected IP ($LIVE_IP) is different from the saved one."
            read -p "Use saved IP ($SAVED_PUBLIC_IP)? (y/n) [y]: " USE_OLD_IP
            USE_OLD_IP=${USE_OLD_IP:-y}
            if [ "$USE_OLD_IP" = "y" ]; then 
                PUBLIC_IP=$SAVED_PUBLIC_IP
            else 
                read -p "Use live detected IP ($LIVE_IP)? (y/n) [y]: " USE_LIVE
                USE_LIVE=${USE_LIVE:-y}
                if [ "$USE_LIVE" = "y" ]; then PUBLIC_IP=$LIVE_IP; else read -p "Enter manual IP: " PUBLIC_IP; fi
            fi
        else
            PUBLIC_IP=$SAVED_PUBLIC_IP
            print_success "Using saved IP: $PUBLIC_IP"
        fi
    else
        read -p "Public IP of this server [$LIVE_IP]: " PUBLIC_IP
        PUBLIC_IP=${PUBLIC_IP:-$LIVE_IP}
    fi

    echo ""
    print_info "Remote Worker Access Security"
    echo "Do you want to allow remote workers to connect via Tailscale/VPN?"
    echo "If yes, RPC ports will be bound to your VPN IP. If no, they remain local-only (127.0.0.1)."
    read -p "Use Tailscale/VPN for RPC? (y/n) [n]: " USE_VPN
    if [ "$USE_VPN" = "y" ]; then
        if [ -n "$DETECTED_TAILSCALE_IP" ]; then
            read -p "Enter Tailscale IP [$DETECTED_TAILSCALE_IP]: " TAILSCALE_IP
            TAILSCALE_IP=${TAILSCALE_IP:-$DETECTED_TAILSCALE_IP}
        else
            read -p "Enter Tailscale IP: " TAILSCALE_IP
        fi
        REMOTE_WORKERS_ENABLED=true
    else
        TAILSCALE_IP=127.0.0.1
        REMOTE_WORKERS_ENABLED=false
    fi
else
    # Worker Setup
    if [ "$WORKER_SETUP_MODE" = "client" ]; then
        # Load existing Main Server IP if available
        existing_main_ip=$(grep "^CORE_SERVICES_HOST=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        [ -z "$existing_main_ip" ] && existing_main_ip=$(grep "^PUBLIC_IP=" .env.core 2>/dev/null | cut -d '=' -f2-)
        
        read -p "Enter Main Server IP/Hostname (Tailscale preferred) [$existing_main_ip]: " MAIN_SERVER_IP
        PUBLIC_IP=${MAIN_SERVER_IP:-$existing_main_ip}
        PUBLIC_IP=${PUBLIC_IP:-127.0.0.1}

        existing_worker_memory_limit=$(grep "^WORKER_MEMORY_LIMIT=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        existing_worker_cpu_limit=$(grep "^WORKER_CPU_LIMIT=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        existing_worker_memory_reservation=$(grep "^WORKER_MEMORY_RESERVATION=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        existing_worker_cpu_reservation=$(grep "^WORKER_CPU_RESERVATION=" .env.worker 2>/dev/null | cut -d '=' -f2-)

        WORKER_MEMORY_LIMIT=${existing_worker_memory_limit:-2G}
        WORKER_CPU_LIMIT=${existing_worker_cpu_limit:-2}
        WORKER_MEMORY_RESERVATION=${existing_worker_memory_reservation:-1G}
        WORKER_CPU_RESERVATION=${existing_worker_cpu_reservation:-1}

        read -p "Worker memory limit (e.g., 2G, 1.5G) [$WORKER_MEMORY_LIMIT]: " WORKER_MEMORY_LIMIT_INPUT
        WORKER_MEMORY_LIMIT=${WORKER_MEMORY_LIMIT_INPUT:-$WORKER_MEMORY_LIMIT}

        read -p "Worker CPU limit (e.g., 2, 0.8) [$WORKER_CPU_LIMIT]: " WORKER_CPU_LIMIT_INPUT
        WORKER_CPU_LIMIT=${WORKER_CPU_LIMIT_INPUT:-$WORKER_CPU_LIMIT}

        read -p "Worker memory reservation [$WORKER_MEMORY_RESERVATION]: " WORKER_MEMORY_RESERVATION_INPUT
        WORKER_MEMORY_RESERVATION=${WORKER_MEMORY_RESERVATION_INPUT:-$WORKER_MEMORY_RESERVATION}

        read -p "Worker CPU reservation [$WORKER_CPU_RESERVATION]: " WORKER_CPU_RESERVATION_INPUT
        WORKER_CPU_RESERVATION=${WORKER_CPU_RESERVATION_INPUT:-$WORKER_CPU_RESERVATION}

        existing_db_host=$(grep "^POSTGRES_HOST=" .env.core 2>/dev/null | cut -d '=' -f2-)
        [ -z "$existing_db_host" ] && existing_db_host=$(grep "^POSTGRES_HOST=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        existing_db_port=$(grep "^POSTGRES_PORT=" .env.core 2>/dev/null | cut -d '=' -f2-)
        [ -z "$existing_db_port" ] && existing_db_port=$(grep "^POSTGRES_PORT=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        existing_db_name=$(grep "^POSTGRES_DB=" .env.core 2>/dev/null | cut -d '=' -f2-)
        [ -z "$existing_db_name" ] && existing_db_name=$(grep "^POSTGRES_DB=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        existing_db_user=$(grep "^POSTGRES_USER=" .env.core 2>/dev/null | cut -d '=' -f2-)
        [ -z "$existing_db_user" ] && existing_db_user=$(grep "^POSTGRES_USER=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        existing_db_password=$(grep "^POSTGRES_PASSWORD=" .env.core 2>/dev/null | cut -d '=' -f2-)
        [ -z "$existing_db_password" ] && existing_db_password=$(grep "^POSTGRES_PASSWORD=" .env.worker 2>/dev/null | cut -d '=' -f2-)

        REMOTE_DB_HOST=${existing_db_host:-$PUBLIC_IP}
        REMOTE_DB_PORT=${existing_db_port:-5432}
        REMOTE_DB_NAME=${existing_db_name:-cmsdb}
        REMOTE_DB_USER=${existing_db_user:-cmsuser}

        read -p "Main Server Database Host [$REMOTE_DB_HOST]: " REMOTE_DB_HOST_INPUT
        REMOTE_DB_HOST=${REMOTE_DB_HOST_INPUT:-$REMOTE_DB_HOST}

        read -p "Main Server Database Port [$REMOTE_DB_PORT]: " REMOTE_DB_PORT_INPUT
        REMOTE_DB_PORT=${REMOTE_DB_PORT_INPUT:-$REMOTE_DB_PORT}

        read -p "Database name [$REMOTE_DB_NAME]: " REMOTE_DB_NAME_INPUT
        REMOTE_DB_NAME=${REMOTE_DB_NAME_INPUT:-$REMOTE_DB_NAME}

        read -p "Database user [$REMOTE_DB_USER]: " REMOTE_DB_USER_INPUT
        REMOTE_DB_USER=${REMOTE_DB_USER_INPUT:-$REMOTE_DB_USER}

        read -s -p "Database password [hidden, leave blank to keep current]: " REMOTE_DB_PASSWORD_INPUT
        echo ""
        if [ -n "$REMOTE_DB_PASSWORD_INPUT" ]; then
            REMOTE_DB_PASSWORD=$REMOTE_DB_PASSWORD_INPUT
        else
            REMOTE_DB_PASSWORD=${existing_db_password:-}
        fi

        if [ -z "$REMOTE_DB_PASSWORD" ]; then
            print_error "Database password is required for remote worker setup."
            exit 1
        fi

        # Custom Core Ports
        existing_log_port=$(grep "^CORE_LOG_PORT=" .env.worker 2>/dev/null | cut -d '=' -f2-)
        CORE_LOG_PORT=${existing_log_port:-29000}
        
        read -p "Main Server Log Service Port [$CORE_LOG_PORT]: " CORE_LOG_PORT_INPUT
        CORE_LOG_PORT_INPUT=${CORE_LOG_PORT_INPUT:-$CORE_LOG_PORT}

        # Secret Key Sync
        existing_secret_key=$(grep "^CMS_SECRET_KEY=" .env.core 2>/dev/null | cut -d '=' -f2-)
        read -p "Main Server Secret Key (from .env.core) [$existing_secret_key]: " SECRET_KEY_INPUT
        CMS_SECRET_KEY=${SECRET_KEY_INPUT:-$existing_secret_key}
        if [ -z "$CMS_SECRET_KEY" ]; then
            print_error "CMS_SECRET_KEY is required for remote worker to authenticate with core."
            exit 1
        fi
        update_env_var .env.core "CMS_SECRET_KEY" "$CMS_SECRET_KEY"

        # Test Connection to Main Server
        print_info "Testing connection to Main Server ($PUBLIC_IP:$CORE_LOG_PORT_INPUT)..."
        if check_connection "$PUBLIC_IP" "$CORE_LOG_PORT_INPUT"; then
            print_success "Connection to Main Server verified."
        else
            print_warning "Unable to connect to $PUBLIC_IP:$CORE_LOG_PORT_INPUT."
            read -p "Continue anyway? (y/n) [y]: " CONTINUE_FAIL_CONN
            CONTINUE_FAIL_CONN=${CONTINUE_FAIL_CONN:-y}
            if [ "$CONTINUE_FAIL_CONN" != "y" ]; then exit 1; fi
        fi

        print_info "Testing connection to Main Server Database ($REMOTE_DB_HOST:$REMOTE_DB_PORT)..."
        if check_connection "$REMOTE_DB_HOST" "$REMOTE_DB_PORT"; then
            print_success "Database endpoint is reachable."
        else
            print_warning "Unable to connect to $REMOTE_DB_HOST:$REMOTE_DB_PORT."
            read -p "Continue anyway? (y/n) [y]: " CONTINUE_FAIL_DB_CONN
            CONTINUE_FAIL_DB_CONN=${CONTINUE_FAIL_DB_CONN:-y}
            if [ "$CONTINUE_FAIL_DB_CONN" != "y" ]; then exit 1; fi
        fi
        
        # Save custom port for later
        update_env_var .env.worker "CORE_LOG_PORT" "$CORE_LOG_PORT_INPUT"
        update_env_var .env.worker "WORKER_MEMORY_LIMIT" "$WORKER_MEMORY_LIMIT"
        update_env_var .env.worker "WORKER_CPU_LIMIT" "$WORKER_CPU_LIMIT"
        update_env_var .env.worker "WORKER_MEMORY_RESERVATION" "$WORKER_MEMORY_RESERVATION"
        update_env_var .env.worker "WORKER_CPU_RESERVATION" "$WORKER_CPU_RESERVATION"
    else
        if [ -f .env.core ]; then
            EXISTING_PUBLIC_IP=$(grep "^PUBLIC_IP=" .env.core | cut -d '=' -f2-)
            PUBLIC_IP=${EXISTING_PUBLIC_IP:-127.0.0.1}
        else
            PUBLIC_IP=127.0.0.1
        fi
    fi
fi

# 4. Database Configuration (Main Server Only)
echo ""
if [ "$SETUP_TYPE" = "main" ]; then
    print_step "Database Configuration"
    if [ "$IS_UPDATE" = "true" ]; then
        print_info "Reusing existing database credentials."
        DB_PASS=$DETECTED_DB_PASS
    else
        read -p "Database password [generate random]: " DB_PASS
        if [ -z "$DB_PASS" ]; then
            DB_PASS=$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-12)
            print_info "Generated password: $DB_PASS"
        fi
    fi
fi

# 5. Environment Generation
echo ""
print_step "Updating Configuration Files..."

REGENERATE="n"
if [ "$IS_UPDATE" = "true" ]; then
    echo "Existing configuration files detected."
    read -p "Regenerate files from scratch? (y/n) [n]: " REGENERATE
    REGENERATE=${REGENERATE:-n}
fi

if [ "$REGENERATE" = "y" ]; then
    if [ "$SETUP_TYPE" = "main" ]; then
    # Prepare .env.core
    write_or_print .env.core << EOF
# Generated by setup.sh
PUBLIC_IP=$PUBLIC_IP
TAILSCALE_IP=$TAILSCALE_IP
REMOTE_WORKERS_ENABLED=$REMOTE_WORKERS_ENABLED
POSTGRES_DB=cmsdb
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=${DB_PASS:-remote_worker_no_db}
POSTGRES_PORT_EXTERNAL=5432
POSTGRES_HOST_AUTH_METHOD=md5
CMS_CONFIG=/usr/local/etc/cms.toml
LOG_SERVICE_SHARD=0
RESOURCE_SERVICE_SHARD=0
SCORING_SERVICE_SHARD=0
EVALUATION_SERVICE_SHARD=0
PROXY_SERVICE_SHARD=0
CHECKER_SERVICE_SHARD=0
# Workers are managed via Admin UI and stored here as WORKER_N variables
EOF

    # Prepare .env.admin
    write_or_print .env.admin << EOF
# Generated by setup.sh
DEPLOYMENT_TYPE=$DEPLOY_TYPE
VITE_API_URL=http://$PUBLIC_IP:8889
SERVER_BASE_URL=http://$PUBLIC_IP
ADMIN_NEXT_PORT_EXTERNAL=8891
ADMIN_NEXT_DOMAIN=admin-next.cms.local
ADMIN_PORT_EXTERNAL=8889
ADMIN_DOMAIN=admin.cms.local
RANKING_PORT_EXTERNAL=8890
RANKING_DOMAIN=ranking.cms.local
ADMIN_COOKIE_DURATION=36000
EOF

    # Prepare .env.contest
    EXISTING_MULTI_CONFIG='[]'
    SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
    write_or_print .env.contest << EOF
# Generated by setup.sh
CONTESTS_DEPLOY_CONFIG=$EXISTING_MULTI_CONFIG
SECRET_KEY=$SECRET_KEY
COOKIE_DURATION=10800
ACCESS_METHOD=public_port
RANKING_USERNAME=admin
RANKING_PASSWORD=adminpass
EOF

    # Prepare .env.worker
    write_or_print .env.worker << EOF
# Generated by setup.sh
WORKER_REPLICAS=1
WORKER_MEMORY_LIMIT=2G
WORKER_CPU_LIMIT=2
CORE_SERVICES_HOST=$PUBLIC_IP
EOF

    # Prepare .env.infra
    write_or_print .env.infra << EOF
# Generated by setup.sh
DISCORD_WEBHOOK_URL=$DISCORD_WEBHOOK
DISCORD_ROLE_ID=$DISCORD_ROLE
MONITOR_CPU_THRESHOLD=80
MONITOR_MEM_THRESHOLD=80
MONITOR_DISK_THRESHOLD=80
MONITOR_INTERVAL=10
MONITOR_COOLDOWN=300
DISK_PATH=/host
BACKUP_INTERVAL_MINS=1440
BACKUP_MAX_COUNT=50
BACKUP_MAX_AGE_DAYS=10
BACKUP_MAX_SIZE_GB=5
EOF
    fi

    if [ "$SETUP_TYPE" = "worker" ]; then
    # Prepare .env.worker for worker-only setup
    write_or_print .env.worker << EOF
# Generated by setup.sh
WORKER_REPLICAS=1
WORKER_MEMORY_LIMIT=$WORKER_MEMORY_LIMIT
WORKER_CPU_LIMIT=$WORKER_CPU_LIMIT
WORKER_MEMORY_RESERVATION=$WORKER_MEMORY_RESERVATION
WORKER_CPU_RESERVATION=$WORKER_CPU_RESERVATION
CORE_SERVICES_HOST=$PUBLIC_IP
POSTGRES_HOST=${REMOTE_DB_HOST:-$PUBLIC_IP}
POSTGRES_PORT=${REMOTE_DB_PORT:-5432}
POSTGRES_DB=${REMOTE_DB_NAME:-cmsdb}
POSTGRES_USER=${REMOTE_DB_USER:-cmsuser}
POSTGRES_PASSWORD=${REMOTE_DB_PASSWORD:-}
DEPLOYMENT_TYPE=$DEPLOY_TYPE
EOF
    # Also create a minimal .env.core to satisfy inject_config.sh
    write_or_print .env.core << EOF
# Minimal .env.core for worker node
PUBLIC_IP=$PUBLIC_IP
CORE_SERVICES_IP=$PUBLIC_IP
POSTGRES_HOST=${REMOTE_DB_HOST:-$PUBLIC_IP}
POSTGRES_PORT=${REMOTE_DB_PORT:-5432}
POSTGRES_DB=${REMOTE_DB_NAME:-cmsdb}
POSTGRES_USER=${REMOTE_DB_USER:-cmsuser}
POSTGRES_PASSWORD=${REMOTE_DB_PASSWORD:-}
DEPLOYMENT_TYPE=$DEPLOY_TYPE
EOF
    fi
else
    # Non-destructive update: Only update the variables determined by the setup flow
    if [ "$SETUP_TYPE" = "main" ]; then
        if [ "$DRY_RUN" = "true" ]; then
            echo "DRY-RUN: Would update .env.core: PUBLIC_IP=$PUBLIC_IP"
            echo "DRY-RUN: Would update .env.core: TAILSCALE_IP=$TAILSCALE_IP"
            echo "DRY-RUN: Would update .env.core: REMOTE_WORKERS_ENABLED=$REMOTE_WORKERS_ENABLED"
            [ -n "$DB_PASS" ] && echo "DRY-RUN: Would update .env.core: POSTGRES_PASSWORD=$DB_PASS"

            echo "DRY-RUN: Would update .env.admin: DEPLOYMENT_TYPE=$DEPLOY_TYPE"
            echo "DRY-RUN: Would update .env.admin: VITE_API_URL=http://$PUBLIC_IP:8889"
            echo "DRY-RUN: Would update .env.admin: SERVER_BASE_URL=http://$PUBLIC_IP"

            echo "DRY-RUN: Would update .env.worker: CORE_SERVICES_HOST=$PUBLIC_IP"

            [ -n "$DISCORD_WEBHOOK" ] && echo "DRY-RUN: Would update .env.infra: DISCORD_WEBHOOK_URL=$DISCORD_WEBHOOK"
            [ -n "$DISCORD_ROLE" ] && echo "DRY-RUN: Would update .env.infra: DISCORD_ROLE_ID=$DISCORD_ROLE"
        else
            update_env_var .env.core "PUBLIC_IP" "$PUBLIC_IP"
            update_env_var .env.core "TAILSCALE_IP" "$TAILSCALE_IP"
            update_env_var .env.core "REMOTE_WORKERS_ENABLED" "$REMOTE_WORKERS_ENABLED"
            [ -n "$DB_PASS" ] && update_env_var .env.core "POSTGRES_PASSWORD" "$DB_PASS"

            update_env_var .env.admin "DEPLOYMENT_TYPE" "$DEPLOY_TYPE"
            update_env_var .env.admin "VITE_API_URL" "http://$PUBLIC_IP:8889"
            update_env_var .env.admin "SERVER_BASE_URL" "http://$PUBLIC_IP"

            update_env_var .env.worker "CORE_SERVICES_HOST" "$PUBLIC_IP"

            [ -n "$DISCORD_WEBHOOK" ] && update_env_var .env.infra "DISCORD_WEBHOOK_URL" "$DISCORD_WEBHOOK"
            [ -n "$DISCORD_ROLE" ] && update_env_var .env.infra "DISCORD_ROLE_ID" "$DISCORD_ROLE"
        fi
    else
        if [ "$DRY_RUN" = "true" ]; then
            echo "DRY-RUN: Would update .env.worker: CORE_SERVICES_HOST=$PUBLIC_IP"
            [ -n "$REMOTE_DB_HOST" ] && echo "DRY-RUN: Would update .env.worker: POSTGRES_HOST=$REMOTE_DB_HOST"
            [ -n "$REMOTE_DB_PORT" ] && echo "DRY-RUN: Would update .env.worker: POSTGRES_PORT=$REMOTE_DB_PORT"
            [ -n "$REMOTE_DB_NAME" ] && echo "DRY-RUN: Would update .env.worker: POSTGRES_DB=$REMOTE_DB_NAME"
            [ -n "$REMOTE_DB_USER" ] && echo "DRY-RUN: Would update .env.worker: POSTGRES_USER=$REMOTE_DB_USER"
            [ -n "$REMOTE_DB_PASSWORD" ] && echo "DRY-RUN: Would update .env.worker: POSTGRES_PASSWORD=<hidden>"
            [ -n "$WORKER_MEMORY_LIMIT" ] && echo "DRY-RUN: Would update .env.worker: WORKER_MEMORY_LIMIT=$WORKER_MEMORY_LIMIT"
            [ -n "$WORKER_CPU_LIMIT" ] && echo "DRY-RUN: Would update .env.worker: WORKER_CPU_LIMIT=$WORKER_CPU_LIMIT"
            [ -n "$WORKER_MEMORY_RESERVATION" ] && echo "DRY-RUN: Would update .env.worker: WORKER_MEMORY_RESERVATION=$WORKER_MEMORY_RESERVATION"
            [ -n "$WORKER_CPU_RESERVATION" ] && echo "DRY-RUN: Would update .env.worker: WORKER_CPU_RESERVATION=$WORKER_CPU_RESERVATION"
            echo "DRY-RUN: Would update .env.core: PUBLIC_IP=$PUBLIC_IP"
            echo "DRY-RUN: Would update .env.core: CORE_SERVICES_IP=$PUBLIC_IP"
            [ -n "$REMOTE_DB_HOST" ] && echo "DRY-RUN: Would update .env.core: POSTGRES_HOST=$REMOTE_DB_HOST"
            [ -n "$REMOTE_DB_PORT" ] && echo "DRY-RUN: Would update .env.core: POSTGRES_PORT=$REMOTE_DB_PORT"
            [ -n "$REMOTE_DB_NAME" ] && echo "DRY-RUN: Would update .env.core: POSTGRES_DB=$REMOTE_DB_NAME"
            [ -n "$REMOTE_DB_USER" ] && echo "DRY-RUN: Would update .env.core: POSTGRES_USER=$REMOTE_DB_USER"
            [ -n "$REMOTE_DB_PASSWORD" ] && echo "DRY-RUN: Would update .env.core: POSTGRES_PASSWORD=<hidden>"
        else
            update_env_var .env.worker "CORE_SERVICES_HOST" "$PUBLIC_IP"
            update_env_var .env.worker "DEPLOYMENT_TYPE" "$DEPLOY_TYPE"
            [ -n "$REMOTE_DB_HOST" ] && update_env_var .env.worker "POSTGRES_HOST" "$REMOTE_DB_HOST"
            [ -n "$REMOTE_DB_PORT" ] && update_env_var .env.worker "POSTGRES_PORT" "$REMOTE_DB_PORT"
            [ -n "$REMOTE_DB_NAME" ] && update_env_var .env.worker "POSTGRES_DB" "$REMOTE_DB_NAME"
            [ -n "$REMOTE_DB_USER" ] && update_env_var .env.worker "POSTGRES_USER" "$REMOTE_DB_USER"
            [ -n "$REMOTE_DB_PASSWORD" ] && update_env_var .env.worker "POSTGRES_PASSWORD" "$REMOTE_DB_PASSWORD"
            [ -n "$WORKER_MEMORY_LIMIT" ] && update_env_var .env.worker "WORKER_MEMORY_LIMIT" "$WORKER_MEMORY_LIMIT"
            [ -n "$WORKER_CPU_LIMIT" ] && update_env_var .env.worker "WORKER_CPU_LIMIT" "$WORKER_CPU_LIMIT"
            [ -n "$WORKER_MEMORY_RESERVATION" ] && update_env_var .env.worker "WORKER_MEMORY_RESERVATION" "$WORKER_MEMORY_RESERVATION"
            [ -n "$WORKER_CPU_RESERVATION" ] && update_env_var .env.worker "WORKER_CPU_RESERVATION" "$WORKER_CPU_RESERVATION"
            # Also ensure .env.core exists or is updated for workers
            if [ ! -f .env.core ]; then
                echo "# Minimal .env.core for worker node" > .env.core
            fi
            update_env_var .env.core "PUBLIC_IP" "$PUBLIC_IP"
            update_env_var .env.core "CORE_SERVICES_IP" "$PUBLIC_IP"
            update_env_var .env.core "DEPLOYMENT_TYPE" "$DEPLOY_TYPE"
            [ -n "$REMOTE_DB_HOST" ] && update_env_var .env.core "POSTGRES_HOST" "$REMOTE_DB_HOST"
            [ -n "$REMOTE_DB_PORT" ] && update_env_var .env.core "POSTGRES_PORT" "$REMOTE_DB_PORT"
            [ -n "$REMOTE_DB_NAME" ] && update_env_var .env.core "POSTGRES_DB" "$REMOTE_DB_NAME"
            [ -n "$REMOTE_DB_USER" ] && update_env_var .env.core "POSTGRES_USER" "$REMOTE_DB_USER"
            [ -n "$REMOTE_DB_PASSWORD" ] && update_env_var .env.core "POSTGRES_PASSWORD" "$REMOTE_DB_PASSWORD"
        fi
    fi
fi

if [ "$SETUP_TYPE" = "main" ]; then
    echo ""
    read -p "Configure worker mounting entries in .env.core now? (y/n) [n]: " CONFIGURE_WORKER_MOUNTING
    CONFIGURE_WORKER_MOUNTING=${CONFIGURE_WORKER_MOUNTING:-n}
    if [ "$CONFIGURE_WORKER_MOUNTING" = "y" ]; then
        read -p "How many worker entries to add? [1]: " MAIN_WORKER_COUNT
        MAIN_WORKER_COUNT=${MAIN_WORKER_COUNT:-1}
        if ! is_positive_int "$MAIN_WORKER_COUNT"; then
            print_error "Worker count must be a positive integer."
            exit 1
        fi

        read -p "Base worker port (ports = base + idx) [26000]: " MAIN_WORKER_BASE_PORT
        MAIN_WORKER_BASE_PORT=${MAIN_WORKER_BASE_PORT:-26000}
        if ! is_positive_int "$MAIN_WORKER_BASE_PORT"; then
            print_error "Base worker port must be a positive integer."
            exit 1
        fi

        read -p "Worker host/IP for new entries [RESERVED]: " MAIN_WORKER_HOST
        MAIN_WORKER_HOST=${MAIN_WORKER_HOST:-RESERVED}

        run_or_print "./scripts/manage-workers.sh bulk-add '$MAIN_WORKER_HOST' '$MAIN_WORKER_BASE_PORT' '$MAIN_WORKER_COUNT'"
    fi
fi

# ── Worker-client: generate per-instance env files + start containers, exit early
# (must run BEFORE make env so remote worker hosts don't need .env.core)
if [ "$SETUP_TYPE" = "worker" ] && [ "$WORKER_SETUP_MODE" = "client" ]; then
    print_step "Preparing Worker Client Instances"
    
    if [ "$DRY_RUN" != "true" ]; then
        # Ensure external resources exist on worker node
        echo "Ensuring required Docker resources exist..."
        docker network create cms-network 2>/dev/null || true
        docker volume create cms-logs 2>/dev/null || true
        docker volume create cms-cache 2>/dev/null || true
        docker volume create cms-data 2>/dev/null || true
    fi

    run_or_print "mkdir -p workers"

    WORKER_START_CMDS=""
    i=0
    while [ $i -lt "$WORKER_INSTANCE_COUNT" ]; do
        instance_port=$((WORKER_BASE_PORT + i))
        env_file="workers/.env.worker.instance$i"
        
        # Determine compose command based on deployment strategy
        if [ "$DEPLOY_TYPE" = "img" ]; then
            compose_cmd="docker compose --env-file '$env_file' -p 'cms-worker-$i' -f docker-compose.worker.yml -f docker-compose.worker.img.yml up -d --no-build"
        else
            compose_cmd="docker compose --env-file '$env_file' -p 'cms-worker-$i' -f docker-compose.worker.yml up -d --build"
        fi

        if [ "$DRY_RUN" = "true" ]; then
            echo "DRY-RUN: Would generate $env_file and add WORKER_$i=0.0.0.0:$instance_port to .env.core"
            echo "  WORKER_SHARD=$i  WORKER_PORT=$instance_port  CORE_SERVICES_HOST=$PUBLIC_IP"
            echo "  WORKER_MEMORY_LIMIT=$WORKER_MEMORY_LIMIT  WORKER_CPU_LIMIT=$WORKER_CPU_LIMIT"
            echo "  WORKER_MEMORY_RESERVATION=$WORKER_MEMORY_RESERVATION  WORKER_CPU_RESERVATION=$WORKER_CPU_RESERVATION"
        else
            # Inject worker into .env.core for cms.toml generation
            update_env_var .env.core "WORKER_$i" "0.0.0.0:$instance_port"

            cat > "$env_file" << EOF
WORKER_SHARD=$i
WORKER_NAME=worker-$i
WORKER_REPLICAS=1
WORKER_MEMORY_LIMIT=$WORKER_MEMORY_LIMIT
WORKER_CPU_LIMIT=$WORKER_CPU_LIMIT
WORKER_MEMORY_RESERVATION=$WORKER_MEMORY_RESERVATION
WORKER_CPU_RESERVATION=$WORKER_CPU_RESERVATION
WORKER_PORT=$instance_port
CORE_SERVICES_HOST=$PUBLIC_IP
CMS_CONFIG=/usr/local/etc/cms.toml
EOF
            print_success "Generated $env_file"
        fi
        i=$((i + 1))
    done

    # Generate config files AFTER all workers are injected into .env.core
    if [ "$DRY_RUN" != "true" ]; then
        print_info "Generating configuration with injected worker shards..."
        make env
        
        # Pull images if using pre-built images
        if [ "$DEPLOY_TYPE" = "img" ]; then
            print_info "Pulling latest worker images..."
            make pull-worker
        fi
    fi

    # Start the containers
    i=0
    while [ $i -lt "$WORKER_INSTANCE_COUNT" ]; do
        instance_port=$((WORKER_BASE_PORT + i))
        env_file="workers/.env.worker.instance$i"
        if [ "$DEPLOY_TYPE" = "img" ]; then
            compose_cmd="docker compose --env-file '$env_file' -p 'cms-worker-$i' -f docker-compose.worker.yml -f docker-compose.worker.img.yml up -d --no-build"
        else
            compose_cmd="docker compose --env-file '$env_file' -p 'cms-worker-$i' -f docker-compose.worker.yml up -d --build"
        fi

        if [ "$WORKER_AUTO_START" = "y" ]; then
            run_or_print "$compose_cmd"
        else
            echo "Run later: $compose_cmd"
        fi
        WORKER_START_CMDS="$WORKER_START_CMDS\n  $compose_cmd"
        i=$((i + 1))
    done

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}         Worker Client Setup Completed!                     ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Instances : $WORKER_INSTANCE_COUNT"
    echo "  Ports     : $WORKER_BASE_PORT .. $((WORKER_BASE_PORT + WORKER_INSTANCE_COUNT - 1))"
    echo "  Core host : $PUBLIC_IP"
    echo ""
    # Detect local VPN IP for help message
    LOCAL_VPN_IP=$(ip addr show tailscale0 2>/dev/null | grep -Po 'inet \K[\d.]+' || hostname -I | awk '{print $1}')
    echo "Register these workers on the main server (.env.core) with:"
    echo "  ./scripts/manage-workers.sh bulk-add '$LOCAL_VPN_IP' '$WORKER_BASE_PORT' '$WORKER_INSTANCE_COUNT'"
    echo "  make env && make core-img"
    echo ""
    exit 0
fi

# ── Worker-mounting: register WORKER_N entries in .env.core (run on main server)
if [ "$SETUP_TYPE" = "worker" ] && [ "$WORKER_SETUP_MODE" = "mounting" ]; then
    if [ "$DRY_RUN" != "true" ] && [ "$WORKER_REGISTER_HOST" != "RESERVED" ]; then
        print_info "Verifying worker connectivity before registration..."
        FAILED_WORKERS=0
        i=0
        while [ $i -lt "$WORKER_INSTANCE_COUNT" ]; do
            target_port=$((WORKER_BASE_PORT + i))
            printf "  - Testing worker $i ($WORKER_REGISTER_HOST:$target_port)... "
            if check_connection "$WORKER_REGISTER_HOST" "$target_port"; then
                print_success "ONLINE"
            else
                print_warning "OFFLINE"
                FAILED_WORKERS=$((FAILED_WORKERS + 1))
            fi
            i=$((i + 1))
        done
        
        if [ $FAILED_WORKERS -gt 0 ]; then
            print_warning "$FAILED_WORKERS worker(s) are unreachable."
            read -p "Do you want to continue registration anyway? (y/n) [y]: " CONTINUE_MOUNT
            CONTINUE_MOUNT=${CONTINUE_MOUNT:-y}
            if [ "$CONTINUE_MOUNT" != "y" ]; then exit 1; fi
        fi
    fi
    run_or_print "./scripts/manage-workers.sh bulk-add '$WORKER_REGISTER_HOST' '$WORKER_BASE_PORT' '$WORKER_INSTANCE_COUNT'"
fi

if [ "$DRY_RUN" = "true" ]; then
    echo "DRY-RUN: Would run: make env"
    echo "DRY-RUN: Environment files would be updated (no changes made)."
else
    make env
    print_success "Environment files updated."
fi

if [ "$SETUP_TYPE" = "worker" ] && [ "$WORKER_SETUP_MODE" = "mounting" ]; then
    if [ "$DRY_RUN" = "true" ]; then
        echo "DRY-RUN: Would run: make core-img"
    else
        read -p "Restart core stack now to apply new worker entries? (y/n) [y]: " RESTART_CORE_AFTER_MOUNT
        RESTART_CORE_AFTER_MOUNT=${RESTART_CORE_AFTER_MOUNT:-y}
        if [ "$RESTART_CORE_AFTER_MOUNT" = "y" ]; then
            make core-img
        fi
    fi

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}         Worker Mounting Setup Completed!                   ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "  Registered : $WORKER_INSTANCE_COUNT slot(s) starting at port $WORKER_BASE_PORT"
    echo "  Host       : $WORKER_REGISTER_HOST"
    echo ""
    echo "Update slot IPs when workers are provisioned:"
    echo "  ./scripts/manage-workers.sh update <index> <real-ip> <port>"
    echo "  make env && make core-img"
    echo ""
    exit 0
fi

# 6. Deployment
echo ""

if [ "$SETUP_TYPE" = "main" ]; then
    print_step "Deploying Main Server Stacks..."

    if [ "$DEPLOY_TYPE" = "img" ]; then
        print_info "Pulling latest images..."
        make pull
        make core-img
        make infra-img
        make admin-img
        configure_ranking_auth
        make contest-img
    else
        make core
        make infra
        make admin
        configure_ranking_auth
        make contest
    fi
    
    print_info "Waiting for database..."
    until [ "$(docker inspect -f '{{.State.Health.Status}}' cms-database 2>/dev/null)" == "healthy" ]; do printf "."; sleep 2; done
    echo ""
    
    make cms-init
    make prisma-sync
    
    if [ "$IS_UPDATE" != "true" ]; then
        print_step "User Configuration"
        read -p "Create a superadmin account now? (y/n) [y]: " CREATE_ADMIN
        CREATE_ADMIN=${CREATE_ADMIN:-y}
        if [ "$CREATE_ADMIN" = "y" ]; then make admin-create; fi
    fi

    # Local Worker Option
    echo ""
    read -p "Do you want to deploy a local worker on this machine? (y/n) [n]: " DEPLOY_LOCAL_WORKER
    if [ "$DEPLOY_LOCAL_WORKER" = "y" ]; then
        if [ "$DEPLOY_TYPE" = "img" ]; then
            make pull
            make worker-img
        else
            make worker
        fi
    fi
else
    print_step "Deploying Remote Worker..."
    if [ "$DEPLOY_TYPE" = "img" ]; then
        print_info "Pulling latest images..."
        make pull
        make worker-img
    else
        make worker
    fi
fi

# Final Summary
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}             Setup Completed Successfully!                  ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
if [ "$SETUP_TYPE" = "main" ]; then
    echo -e "🚀 Main Server available at:"
    echo -e "   - Admin UI:   http://$PUBLIC_IP:8891"
    echo -e "   - RPC Listen: $TAILSCALE_IP"
else
    echo -e "🚀 Remote Worker deployed and connecting to $PUBLIC_IP"
fi
echo ""
print_success "Documentation: docs/DEPENDENCIES.md"
echo ""

