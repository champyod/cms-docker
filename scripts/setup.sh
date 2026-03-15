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

# Read a saved value from a .env file (returns empty string if not found)
read_env_var() {
    local file=$1
    local key=$2
    grep "^${key}=" "$file" 2>/dev/null | cut -d '=' -f2- | tr -d '\r' || echo ""
}

# Prompt for an IP binding for a given service
# Usage: prompt_bind_ip <service_label> <current_saved_ip> <public_ip> <tailscale_ip>
# Returns the selected IP in $SELECTED_IP
prompt_bind_ip() {
    local label=$1
    local saved=$2
    local pub=$3
    local tail=$4

    # Build menu dynamically based on what's available
    echo ""
    echo "  Which IP should ${label} bind on?"
    echo "    1) Public IP    (${pub})    — reachable from internet/LAN"
    if [ -n "$tail" ] && [ "$tail" != "127.0.0.1" ]; then
        echo "    2) Tailscale IP (${tail})  — VPN-only access"
        echo "    3) All interfaces (0.0.0.0) — bind to everything"
        echo "    4) Localhost only (127.0.0.1) — this machine only"
    else
        echo "    2) All interfaces (0.0.0.0)  — bind to everything"
        echo "    3) Localhost only (127.0.0.1) — this machine only"
    fi

    # Figure out the default choice number based on saved IP
    local default_choice=1
    if [ -n "$saved" ]; then
        if [ "$saved" = "0.0.0.0" ]; then
            if [ -n "$tail" ] && [ "$tail" != "127.0.0.1" ]; then default_choice=3; else default_choice=2; fi
        elif [ "$saved" = "127.0.0.1" ]; then
            if [ -n "$tail" ] && [ "$tail" != "127.0.0.1" ]; then default_choice=4; else default_choice=3; fi
        elif [ "$saved" = "$tail" ]; then
            default_choice=2
        else
            default_choice=1
        fi
    fi

    read -p "    Select [${default_choice}]: " IP_CHOICE
    IP_CHOICE=${IP_CHOICE:-$default_choice}

    if [ -n "$tail" ] && [ "$tail" != "127.0.0.1" ]; then
        case $IP_CHOICE in
            1) SELECTED_IP="$pub" ;;
            2) SELECTED_IP="$tail" ;;
            3) SELECTED_IP="0.0.0.0" ;;
            4) SELECTED_IP="127.0.0.1" ;;
            *) SELECTED_IP="$pub" ;;
        esac
    else
        case $IP_CHOICE in
            1) SELECTED_IP="$pub" ;;
            2) SELECTED_IP="0.0.0.0" ;;
            3) SELECTED_IP="127.0.0.1" ;;
            *) SELECTED_IP="$pub" ;;
        esac
    fi
}

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
QUICK_UPDATE=n
if [ -f .env.core ]; then
    IS_UPDATE=true
    print_warning "Existing configuration (.env.core) detected. Switching to UPDATE mode."
    
    # Load existing variables
    DETECTED_DB_PASS=$(read_env_var .env.core POSTGRES_PASSWORD)
    SAVED_PUBLIC_IP=$(read_env_var .env.core PUBLIC_IP)
    DETECTED_TAILSCALE_IP=$(read_env_var .env.core TAILSCALE_IP)
    
    # Secrets detection
    DETECTED_AUTH_SECRET=$(read_env_var .env.admin AUTH_SECRET)
    DETECTED_CONTEST_SECRET=$(read_env_var .env.contest SECRET_KEY)
    DETECTED_CMS_SECRET=$(read_env_var .env.core CMS_SECRET_KEY)
    
    # Check .env.admin for DEPLOYMENT_TYPE
    DETECTED_DEPLOY_TYPE=$(read_env_var .env.admin DEPLOYMENT_TYPE)
    
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

    echo ""
    print_step "Quick Update"
    read -p "Do you want to run a Quick Update? This will keep all your old settings and just check for new missing variables. (y/n) [y]: " QUICK_UPDATE
    QUICK_UPDATE=${QUICK_UPDATE:-y}
    
    if [ "$QUICK_UPDATE" = "y" ]; then
        print_success "Quick Update selected. Bypassing configuration questions..."
        
        # Determine Setup Type automatically based on existing configs
        if [ -n "$DETECTED_DB_PASS" ] && [ "$DETECTED_DB_PASS" != "remote_worker_no_db" ]; then
            SETUP_TYPE="main"
        else
            SETUP_TYPE="worker"
        fi
        
        DEPLOY_TYPE=${DETECTED_DEPLOY_TYPE:-img}
        PUBLIC_IP=${SAVED_PUBLIC_IP:-127.0.0.1}
        TAILSCALE_IP=${DETECTED_TAILSCALE_IP:-127.0.0.1}
        
        if [ "$TAILSCALE_IP" != "127.0.0.1" ]; then
            REMOTE_WORKERS_ENABLED=true
        else
            REMOTE_WORKERS_ENABLED=false
        fi
        
        DB_PASS=$DETECTED_DB_PASS
        
        if [ -z "$DETECTED_AUTH_SECRET" ]; then
            AUTH_SECRET=$(openssl rand -hex 32)
        else
            AUTH_SECRET=$DETECTED_AUTH_SECRET
        fi
        
        if [ -z "$DETECTED_CMS_SECRET" ]; then
            CMS_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
        else
            CMS_SECRET=$DETECTED_CMS_SECRET
        fi
        
        if [ -z "$DETECTED_CONTEST_SECRET" ]; then
            CONTEST_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
        else
            CONTEST_SECRET=$DETECTED_CONTEST_SECRET
        fi
        
        # Skip straight to Section 5 Generation
        SKIP_QUESTIONS=true
    else
        SKIP_QUESTIONS=false
    fi
else
    SKIP_QUESTIONS=false
fi

if [ "$SKIP_QUESTIONS" != "true" ]; then
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
        
        # Worker connectivity to Core
        echo ""
        print_info "Core Service Connectivity"
        echo "How should this worker connect to the Main Server?"
        echo "1) Network IP / Public IP"
        echo "2) Tailscale / VPN IP (Recommended for security)"
        echo "3) Manual IP/Hostname"
        read -p "Select connectivity [2]: " CONN_CHOICE
        CONN_CHOICE=${CONN_CHOICE:-2}
        
        case $CONN_CHOICE in
            1) 
                LIVE_IP=$(curl -s -4 ifconfig.me || echo "127.0.0.1")
                read -p "Enter Main Server Public IP [$LIVE_IP]: " MAIN_SERVER_IP
                MAIN_SERVER_IP=${MAIN_SERVER_IP:-$LIVE_IP}
                ;;
            2)
                read -p "Enter Main Server VPN/Tailscale IP: " MAIN_SERVER_IP
                ;;
            3)
                read -p "Enter Main Server IP/Hostname: " MAIN_SERVER_IP
                ;;
        esac
        PUBLIC_IP=$MAIN_SERVER_IP
        
        # Ask for Core RPC Port
        read -p "Enter Main Server RPC Port (LogService) [29000]: " CORE_RPC_PORT
        CORE_RPC_PORT=${CORE_RPC_PORT:-29000}
    else
        SETUP_TYPE="main"
        print_info "Configuring as Main Server."
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
            if [ -n "$DETECTED_TAILSCALE_IP" ] && [ "$DETECTED_TAILSCALE_IP" != "127.0.0.1" ]; then
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
        read -p "Enter Main Server IP/Hostname (Tailscale preferred): " MAIN_SERVER_IP
        PUBLIC_IP=$MAIN_SERVER_IP
    fi

    # 4. Database Configuration & Secrets (Main Server Only)
    echo ""
    if [ "$SETUP_TYPE" = "main" ]; then
        print_step "Database Configuration & Secrets"
        if [ "$IS_UPDATE" = "true" ]; then
            print_info "Reusing existing database credentials."
            DB_PASS=$DETECTED_DB_PASS
            
            # Check AUTH_SECRET
            if [ -n "$DETECTED_AUTH_SECRET" ]; then
                read -p "Regenerate Admin Panel AUTH_SECRET? (y/n) [n]: " REGEN_AUTH
                if [ "$REGEN_AUTH" = "y" ]; then
                    AUTH_SECRET=$(openssl rand -hex 32)
                else
                    AUTH_SECRET=$DETECTED_AUTH_SECRET
                fi
            else
                AUTH_SECRET=$(openssl rand -hex 32)
            fi
            
            # Check CMS_SECRET_KEY
            if [ -n "$DETECTED_CMS_SECRET" ]; then
                read -p "Regenerate Core CMS Secret Key? (y/n) [n]: " REGEN_CMS_SEC
                if [ "$REGEN_CMS_SEC" = "y" ]; then
                    CMS_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
                    if [ -f config/cms.toml ]; then
                        sed -i "s/secret_key = \".*\"/secret_key = \"$CMS_SECRET\"/" config/cms.toml
                    fi
                else
                    CMS_SECRET=$DETECTED_CMS_SECRET
                fi
            else
                CMS_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
            fi
            
            # Check CONTEST_SECRET
            if [ -n "$DETECTED_CONTEST_SECRET" ]; then
                read -p "Regenerate Contest Server Secret Key? (y/n) [n]: " REGEN_CONTEST_SEC
                if [ "$REGEN_CONTEST_SEC" = "y" ]; then
                    CONTEST_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
                else
                    CONTEST_SECRET=$DETECTED_CONTEST_SECRET
                fi
            else
                CONTEST_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
            fi
        else
            read -p "Database password [generate random]: " DB_PASS
            if [ -z "$DB_PASS" ]; then
                DB_PASS=$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-12)
                print_info "Generated password: $DB_PASS"
            fi
            AUTH_SECRET=$(openssl rand -hex 32)
            CMS_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
            CONTEST_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
        fi
    fi
fi # End SKIP_QUESTIONS block


# 5. Environment Generation
echo ""
print_step "Updating Configuration Files..."

REGENERATE="n"
if [ "$QUICK_UPDATE" = "y" ]; then
    echo "Quick Update: Keeping existing configuration structure."
elif [ "$IS_UPDATE" = "true" ]; then
    echo "Existing configuration files detected."
    read -p "Regenerate files from scratch? (y/n) [n]: " REGENERATE
    REGENERATE=${REGENERATE:-n}
fi

if [ "$REGENERATE" = "y" ]; then
    # Prepare .env.core
    cat > .env.core << EOF
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
CMS_SECRET_KEY=$CMS_SECRET
# Workers are managed via Admin UI and stored here as WORKER_N variables
EOF

    # Prepare .env.admin
    cat > .env.admin << EOF
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
RANKING_USERNAME=admin
RANKING_PASSWORD=adminpass
ADMIN_COOKIE_DURATION=36000
AUTH_SECRET=$AUTH_SECRET
EOF

    # Prepare .env.contest (preserve existing CONTESTS_DEPLOY_CONFIG if it exists)
    EXISTING_MULTI_CONFIG=$(read_env_var .env.contest CONTESTS_DEPLOY_CONFIG || echo '[]')
    [ -z "$EXISTING_MULTI_CONFIG" ] && EXISTING_MULTI_CONFIG='[]'
    cat > .env.contest << EOF
# Generated by setup.sh
CONTESTS_DEPLOY_CONFIG=$EXISTING_MULTI_CONFIG
SECRET_KEY=$CONTEST_SECRET
COOKIE_DURATION=10800
ACCESS_METHOD=public_port
EOF

    # Prepare .env.worker
    cat > .env.worker << EOF
# Generated by setup.sh
WORKER_REPLICAS=1
WORKER_MEMORY_LIMIT=2G
WORKER_CPU_LIMIT=2
CORE_SERVICES_HOST=$PUBLIC_IP
EOF

    # Prepare .env.infra
    cat > .env.infra << EOF
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
else
    # Non-destructive update: Only update the variables determined by the setup flow
    update_env_var .env.core "PUBLIC_IP" "$PUBLIC_IP"
    update_env_var .env.core "TAILSCALE_IP" "$TAILSCALE_IP"
    update_env_var .env.core "REMOTE_WORKERS_ENABLED" "$REMOTE_WORKERS_ENABLED"
    [ -n "$DB_PASS" ] && update_env_var .env.core "POSTGRES_PASSWORD" "$DB_PASS"
    [ -n "$CMS_SECRET" ] && update_env_var .env.core "CMS_SECRET_KEY" "$CMS_SECRET"
    
    update_env_var .env.admin "DEPLOYMENT_TYPE" "$DEPLOY_TYPE"
    update_env_var .env.admin "VITE_API_URL" "http://$PUBLIC_IP:8889"
    update_env_var .env.admin "SERVER_BASE_URL" "http://$PUBLIC_IP"
    [ -n "$AUTH_SECRET" ] && update_env_var .env.admin "AUTH_SECRET" "$AUTH_SECRET"
    
    [ -n "$CONTEST_SECRET" ] && update_env_var .env.contest "SECRET_KEY" "$CONTEST_SECRET"
    
    update_env_var .env.worker "CORE_SERVICES_HOST" "$PUBLIC_IP"
    
    [ -n "$DISCORD_WEBHOOK" ] && update_env_var .env.infra "DISCORD_WEBHOOK_URL" "$DISCORD_WEBHOOK"
    [ -n "$DISCORD_ROLE" ] && update_env_var .env.infra "DISCORD_ROLE_ID" "$DISCORD_ROLE"
    
    # Check for new upstream configuration variables
    print_step "Checking for new upstream configuration variables..."
    for template in .env.*.example; do
        [ -f "$template" ] || continue
        target="${template%.example}"
        if [ -f "$target" ]; then
            grep -E '^#?[[:space:]]*[A-Za-z0-9_]+=' "$template" | while read -r line; do
                # Determine if it's a commented variable
                is_commented=false
                if [[ "$line" =~ ^# ]]; then
                    is_commented=true
                fi
                
                # Extract key and value
                key=$(echo "$line" | sed -E 's/^#?[[:space:]]*([^=]+)=.*/\1/')
                default_val=$(echo "$line" | cut -d '=' -f2-)
                
                # Skip known secrets handled dynamically
                if [ "$key" = "AUTH_SECRET" ] || [ "$key" = "SECRET_KEY" ] || [ "$key" = "CMS_SECRET_KEY" ]; then
                    continue
                fi
                
                # Check if the variable exists (commented or uncommented)
                if ! grep -q -E "^#?[[:space:]]*${key}=" "$target"; then
                    if [ "$is_commented" = true ]; then
                        # Variable is commented in template, just append it commented silently
                        echo "$line" >> "$target"
                        print_info "Added commented variable ${key} to $target"
                    else
                        print_warning "New variable found in upstream $template: ${key}=${default_val}"
                        if [ "$QUICK_UPDATE" = "y" ]; then
                            ADD_VAR="y"
                        else
                            read -p "Add ${key} to $target? (y/n) [y]: " ADD_VAR
                            ADD_VAR=${ADD_VAR:-y}
                        fi
                        if [ "$ADD_VAR" = "y" ]; then
                            echo "${key}=${default_val}" >> "$target"
                            print_success "Added ${key} to $target"
                        fi
                    fi
                fi
            done
        fi
    done
fi

make env
print_success "Environment files updated."

# 6. Deployment
echo ""

if [ "$SETUP_TYPE" = "main" ]; then

    # ── Helper: resolve bind IP from saved env or prompt ──────────────────────
    # Usage: resolve_bind_ip <env_var_name> <env_file> <label>
    # Sets RESOLVED_IP
    resolve_bind_ip() {
        local var_name=$1
        local env_file=$2
        local label=$3
        local saved
        saved=$(read_env_var "$env_file" "$var_name" 2>/dev/null || echo "")

        prompt_bind_ip "$label" "$saved" "$PUBLIC_IP" "$TAILSCALE_IP"
        RESOLVED_IP="$SELECTED_IP"
        update_env_var "$env_file" "$var_name" "$RESOLVED_IP"
    }

    # ── Helper: resolve port from saved env or prompt ──────────────────────────
    # Usage: resolve_port <env_var_name> <env_file> <label> <default>
    # Sets RESOLVED_PORT
    resolve_port() {
        local var_name=$1
        local env_file=$2
        local label=$3
        local default=$4
        local saved
        saved=$(read_env_var "$env_file" "$var_name" 2>/dev/null || echo "")
        local current="${saved:-$default}"

        read -p "  ${label} port [${current}]: " USER_PORT
        RESOLVED_PORT="${USER_PORT:-$current}"
        update_env_var "$env_file" "$var_name" "$RESOLVED_PORT"
    }

    if [ "$DEPLOY_TYPE" = "img" ]; then
        print_info "Pulling latest images..."
        make pull
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # CORE / DATABASE STACK
    # ─────────────────────────────────────────────────────────────────────────
    echo ""
    print_step "Core / Database Stack"
    echo "  (Required by: Admin Panel, Contest Server, Worker)"
    read -p "Deploy Core/Database stack? (y/n) [y]: " DEPLOY_CORE
    DEPLOY_CORE=${DEPLOY_CORE:-y}
    DEPLOY_CORE_DONE=false

    if [ "$DEPLOY_CORE" = "y" ]; then
        echo ""
        print_info "Configuring Database exposure..."
        resolve_port "POSTGRES_PORT_EXTERNAL" ".env.core" "Postgres" "5432"
        resolve_bind_ip "DB_BIND_IP" ".env.core" "Database (Postgres)"

        if [ "$DEPLOY_TYPE" = "img" ]; then
            make core-img
        else
            make core
        fi

        print_info "Waiting for database to be healthy..."
        until [ "$(docker inspect -f '{{.State.Health.Status}}' cms-database 2>/dev/null)" == "healthy" ]; do
            printf "."
            sleep 2
        done
        echo ""

        make cms-init
        make prisma-sync
        DEPLOY_CORE_DONE=true
    else
        print_warning "Skipping Core stack."
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # ADMIN PANEL STACK
    # ─────────────────────────────────────────────────────────────────────────
    echo ""
    print_step "Admin Panel Stack"
    echo "  (Depends on: Core stack)"
    if [ "$DEPLOY_CORE" != "y" ]; then
        print_warning "Note: Core stack is not being deployed in this run."
    fi
    read -p "Deploy Admin services? (y/n) [y]: " DEPLOY_ADMIN
    DEPLOY_ADMIN=${DEPLOY_ADMIN:-y}

    if [ "$DEPLOY_ADMIN" = "y" ]; then
        echo ""
        print_info "Configuring Admin Panel components..."

        # Sub-service selection
        read -p "  Deploy Admin NEXT (modern panel)? (y/n) [y]: " DEPLOY_ADMIN_NEXT
        DEPLOY_ADMIN_NEXT=${DEPLOY_ADMIN_NEXT:-y}
        if [ "$DEPLOY_ADMIN_NEXT" = "y" ]; then
            resolve_port "ADMIN_NEXT_PORT_EXTERNAL" ".env.admin" "Admin Next.js" "8891"
            resolve_bind_ip "ADMIN_NEXT_BIND_IP" ".env.admin" "Admin Panel (Next.js)"
        fi

        read -p "  Deploy Admin LEGACY (original panel)? (y/n) [y]: " DEPLOY_ADMIN_LEGACY
        DEPLOY_ADMIN_LEGACY=${DEPLOY_ADMIN_LEGACY:-y}
        if [ "$DEPLOY_ADMIN_LEGACY" = "y" ]; then
            resolve_port "ADMIN_PORT_EXTERNAL" ".env.admin" "Admin legacy" "8889"
            resolve_bind_ip "ADMIN_BIND_IP" ".env.admin" "Admin Panel (legacy)"
            
            # Update VITE_API_URL with confirmed port
            CONFIRMED_ADMIN_PORT=$(read_env_var .env.admin ADMIN_PORT_EXTERNAL)
            update_env_var .env.admin "VITE_API_URL" "http://${PUBLIC_IP}:${CONFIRMED_ADMIN_PORT}"
        fi

        read -p "  Deploy RANKING server? (y/n) [y]: " DEPLOY_RANKING
        DEPLOY_RANKING=${DEPLOY_RANKING:-y}
        if [ "$DEPLOY_RANKING" = "y" ]; then
            resolve_port "RANKING_PORT_EXTERNAL" ".env.admin" "Ranking server" "8890"
            resolve_bind_ip "RANKING_BIND_IP" ".env.admin" "Ranking Server"
        fi

        make env  # Regenerate merged .env with updated values
        
        # Deploy selected components
        if [ "$DEPLOY_ADMIN_NEXT" = "y" ] && [ "$DEPLOY_ADMIN_LEGACY" = "y" ] && [ "$DEPLOY_RANKING" = "y" ]; then
            if [ "$DEPLOY_TYPE" = "img" ]; then make admin-img; else make admin; fi
        else
            # Partial deployment
            print_info "Applying partial Admin deployment..."
            # Detect COMPOSE like Makefile
            COMPOSE_BIN=$(docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
            admin_yml="docker-compose.admin.yml"
            [ "$DEPLOY_TYPE" = "img" ] && admin_yml="docker-compose.admin.img.yml"
            
            services=""
            [ "$DEPLOY_ADMIN_NEXT" = "y" ] && services="$services cms-admin-panel"
            [ "$DEPLOY_ADMIN_LEGACY" = "y" ] && services="$services cms-admin-legacy"
            [ "$DEPLOY_RANKING" = "y" ] && services="$services cms-ranking"
            
            $COMPOSE_BIN -f "$admin_yml" up -d $services
        fi

        if [ "$IS_UPDATE" != "true" ] && [ "$DEPLOY_ADMIN_LEGACY" = "y" ]; then
            echo ""
            read -p "Create a superadmin account now? (y/n) [y]: " CREATE_ADMIN
            CREATE_ADMIN=${CREATE_ADMIN:-y}
            if [ "$CREATE_ADMIN" = "y" ]; then make admin-create; fi
        fi
    else
        print_warning "Skipping Admin Panel stack."
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # CONTEST SERVER STACK
    # ─────────────────────────────────────────────────────────────────────────
    echo ""
    print_step "Contest Server Stack"
    echo "  (Depends on: Core stack)"
    if [ "$DEPLOY_CORE" != "y" ]; then
        print_warning "Note: Core stack is not being deployed in this run."
    fi
    read -p "Deploy Contest Server stack? (y/n) [y]: " DEPLOY_CONTEST
    DEPLOY_CONTEST=${DEPLOY_CONTEST:-y}

    if [ "$DEPLOY_CONTEST" = "y" ]; then
        echo ""
        print_info "Configuring Contest Server ports & IPs..."

        resolve_port "CONTEST_PORT_EXTERNAL" ".env.contest" "Contest web server" "8888"
        resolve_bind_ip "CONTEST_BIND_IP" ".env.contest" "Contest Web Server"
        resolve_port "NGINX_HTTP_PORT" ".env.contest" "Nginx HTTP (proxy)" "80"
        resolve_port "NGINX_HTTPS_PORT" ".env.contest" "Nginx HTTPS (proxy)" "443"
        resolve_bind_ip "NGINX_BIND_IP" ".env.contest" "Nginx Proxy"

        # ── Contest Selection ────────────────────────────────────────────────
        echo ""
        print_info "Selecting contest to run..."
        
        # Try to list contests from database
        db_container="cms-database"
        if docker ps | grep -q "$db_container"; then
            db_pass=$(read_env_var .env.core POSTGRES_PASSWORD)
            db_user=$(read_env_var .env.core POSTGRES_USER)
            db_name=$(read_env_var .env.core POSTGRES_DB)
            
            print_info "Available contests in database:"
            docker exec -e PGPASSWORD="$db_pass" "$db_container" psql -U "$db_user" -d "$db_name" -c "SELECT id, name, description FROM contests;" || print_warning "Could not query contests table."
        fi

        saved_contest_id=$(read_env_var .env.contest CONTEST_ID)
        read -p "  Enter Contest ID to run [${saved_contest_id:-1}]: " SELECTED_CONTEST_ID
        SELECTED_CONTEST_ID=${SELECTED_CONTEST_ID:-${saved_contest_id:-1}}
        update_env_var ".env.contest" "CONTEST_ID" "$SELECTED_CONTEST_ID"
        # Also update in .env.core for Evaluation/Proxy services
        update_env_var ".env.core" "CONTEST_ID" "$SELECTED_CONTEST_ID"

        make env  # Regenerate merged .env
        if [ "$DEPLOY_TYPE" = "img" ]; then
            make contest-img
        else
            make contest
        fi
        
        # Restart core services if contest ID changed to ensure evaluation/proxy pick it up
        if [ "$SELECTED_CONTEST_ID" != "$saved_contest_id" ] && [ "$DEPLOY_CORE" != "y" ]; then
            print_info "Contest ID changed. Restarting evaluation and proxy services..."
            COMPOSE_BIN=$(docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
            core_yml="docker-compose.core.yml"
            [ "$DEPLOY_TYPE" = "img" ] && core_yml="docker-compose.core.img.yml"
            $COMPOSE_BIN -f "$core_yml" restart evaluation-service proxy-service
        fi
    else
        print_warning "Skipping Contest Server stack."
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # INFRASTRUCTURE / MONITOR STACK
    # ─────────────────────────────────────────────────────────────────────────
    echo ""
    print_step "Infrastructure / Monitor Stack"
    echo "  (Standalone — Discord alerts, backup, health monitoring)"
    read -p "Deploy Infrastructure/Monitor stack? (y/n) [y]: " DEPLOY_INFRA
    DEPLOY_INFRA=${DEPLOY_INFRA:-y}

    if [ "$DEPLOY_INFRA" = "y" ]; then
        if [ "$DEPLOY_TYPE" = "img" ]; then
            make infra-img
        else
            make infra
        fi
    else
        print_warning "Skipping Infrastructure stack."
    fi

    # ─────────────────────────────────────────────────────────────────────────
    # LOCAL WORKER (optional)
    # ─────────────────────────────────────────────────────────────────────────
    echo ""
    read -p "Do you want to deploy a local worker on this machine? (y/n) [n]: " DEPLOY_LOCAL_WORKER
    DEPLOY_LOCAL_WORKER=${DEPLOY_LOCAL_WORKER:-n}
    if [ "$DEPLOY_LOCAL_WORKER" = "y" ]; then
        if [ "$DEPLOY_TYPE" = "img" ]; then
            make worker-img
        else
            make worker
        fi
    fi

else
    # ─────────────────────────────────────────────────────────────────────────
    # REMOTE WORKER ONLY
    # ─────────────────────────────────────────────────────────────────────────
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
# Default to "y" — Quick Update mode skips deploy prompts so these may be unset
DEPLOY_ADMIN=${DEPLOY_ADMIN:-y}
DEPLOY_CONTEST=${DEPLOY_CONTEST:-y}
ADMIN_NEXT_PORT_OUT=$(read_env_var .env.admin ADMIN_NEXT_PORT_EXTERNAL); ADMIN_NEXT_PORT_OUT=${ADMIN_NEXT_PORT_OUT:-8891}
ADMIN_PORT_OUT=$(read_env_var .env.admin ADMIN_PORT_EXTERNAL); ADMIN_PORT_OUT=${ADMIN_PORT_OUT:-8889}
RANKING_PORT_OUT=$(read_env_var .env.admin RANKING_PORT_EXTERNAL); RANKING_PORT_OUT=${RANKING_PORT_OUT:-8890}
CONTEST_PORT_OUT=$(read_env_var .env.contest CONTEST_PORT_EXTERNAL); CONTEST_PORT_OUT=${CONTEST_PORT_OUT:-8888}
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}             Setup Completed Successfully!                  ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
if [ "$SETUP_TYPE" = "main" ]; then
    echo -e "🚀 Main Server available at:"
    [ "$DEPLOY_ADMIN" = "y" ]   && echo -e "   - Admin UI (Next):   http://$PUBLIC_IP:$ADMIN_NEXT_PORT_OUT"
    [ "$DEPLOY_ADMIN" = "y" ]   && echo -e "   - Admin UI (Legacy): http://$PUBLIC_IP:$ADMIN_PORT_OUT"
    [ "$DEPLOY_ADMIN" = "y" ]   && echo -e "   - Ranking:           http://$PUBLIC_IP:$RANKING_PORT_OUT"
    [ "$DEPLOY_CONTEST" = "y" ] && echo -e "   - Contest Server:    http://$PUBLIC_IP:$CONTEST_PORT_OUT"
    echo -e "   - RPC Listen: $TAILSCALE_IP"
else
    echo -e "🚀 Remote Worker deployed and connecting to $PUBLIC_IP"
fi
echo ""
print_success "Documentation: docs/DEPENDENCIES.md"
echo ""
