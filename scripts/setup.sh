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
    
    # Check .env.admin for DEPLOYMENT_TYPE
    DETECTED_DEPLOY_TYPE=$(grep "^DEPLOYMENT_TYPE=" .env.admin 2>/dev/null | cut -d '=' -f2-)
    
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
    read -p "Enter Main Server IP/Hostname (Tailscale preferred): " MAIN_SERVER_IP
    PUBLIC_IP=$MAIN_SERVER_IP
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
print_step "Generating Configuration Files..."

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
# Workers are managed via Admin UI and stored here as WORKER_N variables
EOF

# ... (rest of environment generation same until deployment)

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
EOF

# Prepare .env.contest
if [ "$IS_UPDATE" = "true" ]; then
    EXISTING_MULTI_CONFIG=$(grep "^CONTESTS_DEPLOY_CONFIG=" .env.contest 2>/dev/null | cut -d '=' -f2- || echo '[]')
    SECRET_KEY=$(grep "^SECRET_KEY=" .env.contest 2>/dev/null | cut -d '=' -f2-)
else
    # Start with NO contests. Everything will be created via Admin UI.
    EXISTING_MULTI_CONFIG='[]'
    SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
fi

cat > .env.contest << EOF
# Generated by setup.sh
CONTESTS_DEPLOY_CONFIG=$EXISTING_MULTI_CONFIG
SECRET_KEY=$SECRET_KEY
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
if [ "$IS_UPDATE" = "true" ]; then
    DISCORD_WEBHOOK=$(grep "^DISCORD_WEBHOOK_URL=" .env.infra 2>/dev/null | cut -d '=' -f2- || echo "")
    DISCORD_ROLE=$(grep "^DISCORD_ROLE_ID=" .env.infra 2>/dev/null | cut -d '=' -f2- || echo "")
else
    echo ""
    print_info "Discord Integration (Optional)"
    read -p "Discord Webhook URL [leave empty to skip]: " DISCORD_WEBHOOK
    read -p "Discord Role ID to tag [optional]: " DISCORD_ROLE
fi

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

make env
print_success "Environment files generated."

# 6. Deployment
echo ""
if [ "$SETUP_TYPE" = "main" ]; then
    print_step "Deploying Main Server Stacks..."
    if [ "$DEPLOY_TYPE" = "img" ]; then
        make core-img
        make infra-img
        make admin-img
        make contest-img
    else
        make core
        make infra
        make admin
        make contest
    fi
    
    print_info "Waiting for database..."
    until [ "$(docker inspect -f '{{.State.Health.Status}}' cms-database 2>/dev/null)" == "healthy" ]; do printf "."; sleep 2; done
    echo ""
    
    make cms-init
    make prisma-sync
    docker exec -i cms-database psql -U cmsuser -d cmsdb < scripts/fix_db_schema.sql
    
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
        if [ "$DEPLOY_TYPE" = "img" ]; then make worker-img; else make worker; fi
    fi
else
    print_step "Deploying Remote Worker..."
    if [ "$DEPLOY_TYPE" = "img" ]; then make worker-img; else make worker; fi
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

