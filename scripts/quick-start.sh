#!/bin/bash

###############################################################################
# CMS Docker Quick Start Script
# Author: CCYod
# Repository: https://github.com/champyod/cms-docker
# 
# This script helps you quickly deploy CMS using Docker Compose
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Banner
clear
echo -e "${CYAN}"
cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ██████╗ ███╗   ███╗███████╗                                ║
║  ██╔════╝ ████╗ ████║██╔════╝                                ║
║  ██║      ██╔████╔██║███████╗                                ║
║  ██║      ██║╚██╔╝██║╚════██║                                ║
║  ╚██████╗ ██║ ╚═╝ ██║███████║                                ║
║   ╚═════╝ ╚═╝     ╚═╝╚══════╝                                ║
║                                                               ║
║           Contest Management System                           ║
║              Docker Quick Start                               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }
print_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# Check prerequisites
print_step "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi
print_success "Docker found"

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi
print_success "Docker Compose found"

# Welcome message
echo ""
print_info "This script will help you deploy CMS with Docker."
echo ""
echo "You will be asked a few questions to configure your deployment."
echo "Press Enter to use default values (shown in brackets)."
echo ""
read -p "Press Enter to continue..."

# Configuration
echo ""
print_step "Configuration"
echo ""

# Access method selection
print_info "Access Method Configuration"
echo ""
echo "How will users access CMS?"
echo "1) Public IP + Ports (Recommended for VPS without domain)"
echo "2) Domain names (Requires DNS configuration)"
read -p "Select access method [1]: " ACCESS_METHOD_CHOICE
ACCESS_METHOD_CHOICE=${ACCESS_METHOD_CHOICE:-1}

if [ "$ACCESS_METHOD_CHOICE" = "1" ]; then
    ACCESS_METHOD="public_port"
    
    # Get public IP
    print_info "Detecting public IP address..."
    DETECTED_IP=$(curl -s -4 ifconfig.me 2>/dev/null || curl -s -4 icanhazip.com 2>/dev/null || echo "")
    
    if [ ! -z "$DETECTED_IP" ]; then
        print_success "Detected public IP: $DETECTED_IP"
        read -p "Use this IP? (y/n) [y]: " USE_DETECTED
        USE_DETECTED=${USE_DETECTED:-y}
        
        if [ "$USE_DETECTED" = "y" ] || [ "$USE_DETECTED" = "Y" ]; then
            PUBLIC_IP=$DETECTED_IP
        else
            read -p "Enter your public IP address: " PUBLIC_IP
        fi
    else
        print_warning "Could not detect public IP automatically"
        read -p "Enter your public IP address (or 0.0.0.0 for localhost): " PUBLIC_IP
        PUBLIC_IP=${PUBLIC_IP:-0.0.0.0}
    fi
    
    print_info "Services will be accessible at:"
    echo "  Contest: http://$PUBLIC_IP:8888"
    echo "  Admin:   http://$PUBLIC_IP:8889"
    echo "  Ranking: http://$PUBLIC_IP:8890"
else
    ACCESS_METHOD="domain"
    
    print_info "Domain Configuration"
    read -p "Contest domain [contest.cms.local]: " CONTEST_DOMAIN
    CONTEST_DOMAIN=${CONTEST_DOMAIN:-contest.cms.local}
    
    read -p "Admin domain [admin.cms.local]: " ADMIN_DOMAIN
    ADMIN_DOMAIN=${ADMIN_DOMAIN:-admin.cms.local}
    
    read -p "Ranking domain [ranking.cms.local]: " RANKING_DOMAIN
    RANKING_DOMAIN=${RANKING_DOMAIN:-ranking.cms.local}
    
    # Still need public IP for remote workers
    DETECTED_IP=$(curl -s -4 ifconfig.me 2>/dev/null || echo "0.0.0.0")
    read -p "Server public IP [$DETECTED_IP]: " PUBLIC_IP
    PUBLIC_IP=${PUBLIC_IP:-$DETECTED_IP}
    
    print_info "Services will be accessible at:"
    echo "  Contest: http://$CONTEST_DOMAIN"
    echo "  Admin:   http://$ADMIN_DOMAIN"
    echo "  Ranking: http://$RANKING_DOMAIN"
    print_warning "Make sure your DNS is configured to point these domains to $PUBLIC_IP"
fi

echo ""

# Database credentials
print_info "Database Configuration"
read -p "Database name [cmsdb]: " DB_NAME
DB_NAME=${DB_NAME:-cmsdb}

read -p "Database user [cmsuser]: " DB_USER
DB_USER=${DB_USER:-cmsuser}

read -sp "Database password [generate random]: " DB_PASS
echo ""
if [ -z "$DB_PASS" ]; then
    DB_PASS=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)
    print_info "Generated password: $DB_PASS"
fi

echo ""

# Contest configuration
print_info "Port Configuration"
read -p "Contest web server port [8888]: " CONTEST_PORT
CONTEST_PORT=${CONTEST_PORT:-8888}

read -p "Admin web server port [8889]: " ADMIN_PORT
ADMIN_PORT=${ADMIN_PORT:-8889}

read -p "Ranking web server port [8890]: " RANKING_PORT
RANKING_PORT=${RANKING_PORT:-8890}

echo ""

# Generate secret key
print_info "Generating secret key for contest sessions..."
if command -v python3 &> /dev/null; then
    # Try to generate using CMS method
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(16))" 2>/dev/null || openssl rand -hex 16)
else
    SECRET_KEY=$(openssl rand -hex 16)
fi
print_success "Secret key generated: $SECRET_KEY"

echo ""

# Worker configuration
print_info "Worker Configuration"
read -p "Number of local workers [2]: " NUM_WORKERS
NUM_WORKERS=${NUM_WORKERS:-2}

echo ""

# Deployment mode
print_info "Deployment Mode"
echo "1) Full deployment (Core + Admin + Contest + Workers)"
echo "2) Core services only"
echo "3) Custom selection"
read -p "Select mode [1]: " DEPLOY_MODE
DEPLOY_MODE=${DEPLOY_MODE:-1}

# Create environment files
echo ""
print_step "Creating environment files..."

# Core environment
cat > .env << EOF
# CMS Core Services Environment Configuration
# Generated on $(date)

# Server Configuration
PUBLIC_IP=$PUBLIC_IP

# Database Configuration
POSTGRES_DB=$DB_NAME
POSTGRES_USER=$DB_USER
POSTGRES_PASSWORD=$DB_PASS
POSTGRES_HOST_AUTH_METHOD=md5

# CMS Configuration
CMS_CONFIG=/usr/local/etc/cms.conf

# Service Shards
LOG_SERVICE_SHARD=0
RESOURCE_SERVICE_SHARD=0
SCORING_SERVICE_SHARD=0
EVALUATION_SERVICE_SHARD=0
PROXY_SERVICE_SHARD=0
CHECKER_SERVICE_SHARD=0
EOF
print_success "Created .env"

# Admin environment
cat > .env.admin << EOF
# CMS Admin Services Environment Configuration
# Generated on $(date)

CMS_CONFIG=/usr/local/etc/cms.conf
CMS_RANKING_CONFIG=/usr/local/etc/cms.ranking.conf

# Access Method
ACCESS_METHOD=$ACCESS_METHOD
PUBLIC_IP=$PUBLIC_IP

# Admin Web Server
ADMIN_LISTEN_ADDRESS=0.0.0.0
ADMIN_LISTEN_PORT=8889
ADMIN_PORT_EXTERNAL=$ADMIN_PORT
ADMIN_DOMAIN=${ADMIN_DOMAIN:-admin.cms.local}
ADMIN_COOKIE_DURATION=36000

# Ranking Web Server
RANKING_LISTEN_ADDRESS=0.0.0.0
RANKING_LISTEN_PORT=8890
RANKING_PORT_EXTERNAL=$RANKING_PORT
RANKING_DOMAIN=${RANKING_DOMAIN:-ranking.cms.local}

# Printing Service
PRINTING_SERVICE_SHARD=0
PRINTING_ENABLED=false
EOF
print_success "Created .env.admin"

# Contest environment
cat > .env.contest << EOF
# CMS Contest Web Server Environment Configuration
# Generated on $(date)

CMS_CONFIG=/usr/local/etc/cms.conf

# Contest Selection
CONTEST_ID=1

# Access Method
ACCESS_METHOD=$ACCESS_METHOD
PUBLIC_IP=$PUBLIC_IP

# Contest Web Server
CONTEST_WEB_SERVER_SHARD=0
CONTEST_LISTEN_ADDRESS=0.0.0.0
CONTEST_LISTEN_PORT=8888
CONTEST_PORT_EXTERNAL=$CONTEST_PORT
CONTEST_DOMAIN=${CONTEST_DOMAIN:-contest.cms.local}

# Security
SECRET_KEY=$SECRET_KEY
COOKIE_DURATION=10800

# Submission Settings
MAX_SUBMISSION_LENGTH=100000
MAX_INPUT_LENGTH=5000000
SUBMIT_LOCAL_COPY=true

# Proxy Configuration
NUM_PROXIES_USED=0

# TLS Configuration
ENABLE_TLS=false

# Resource Limits
CONTEST_WEB_CPU_LIMIT=2
CONTEST_WEB_MEMORY_LIMIT=2G
CONTEST_WEB_CPU_RESERVATION=0.5
CONTEST_WEB_MEMORY_RESERVATION=512M
EOF
print_success "Created .env.contest"

# Worker environment
cat > .env.worker << EOF
# CMS Worker Environment Configuration
# Generated on $(date)

CORE_SERVICES_HOST=cms-log-service
CMS_CONFIG=/usr/local/etc/cms.conf

# Worker Configuration
WORKER_SHARD=0
WORKER_NAME=worker-0

# Sandbox Settings
KEEP_SANDBOX=false
MAX_FILE_SIZE=1048576

# Resource Limits
WORKER_CPU_LIMIT=4
WORKER_MEMORY_LIMIT=4G
WORKER_CPU_RESERVATION=1
WORKER_MEMORY_RESERVATION=1G

# Scaling
WORKER_REPLICAS=1
EOF
print_success "Created .env.worker"

# Update CMS configuration
print_step "Updating CMS configuration..."

if [ -f "config/cms.conf" ]; then
    # Update database connection in cms.conf
    sed -i.bak "s|postgresql+psycopg2://.*@.*:5432/.*\"|postgresql+psycopg2://$DB_USER:$DB_PASS@cms-database:5432/$DB_NAME\"|g" config/cms.conf
    print_success "Updated config/cms.conf"
else
    print_warning "config/cms.conf not found. Please update it manually."
fi

# Build images
echo ""
print_step "Building Docker images..."
read -p "Build Docker images now? (y/n) [y]: " BUILD_IMAGES
BUILD_IMAGES=${BUILD_IMAGES:-y}

if [ "$BUILD_IMAGES" = "y" ] || [ "$BUILD_IMAGES" = "Y" ]; then
    print_info "Building CMS image (this may take several minutes)..."
    docker build -t cms:latest . || {
        print_error "Failed to build Docker image"
        exit 1
    }
    print_success "Image built successfully"
else
    print_warning "Skipping image build. Make sure you have the image ready!"
fi

# Deploy stacks
echo ""
print_step "Deploying CMS..."

deploy_core() {
    print_info "Deploying core services..."
    docker compose -f docker-compose.core.yml --env-file .env up -d
    print_success "Core services deployed"
    
    print_info "Waiting for services to be ready (30 seconds)..."
    sleep 30
}

deploy_admin() {
    print_info "Deploying admin services..."
    docker compose -f docker-compose.admin.yml --env-file .env.admin up -d
    print_success "Admin services deployed"
    sleep 5
}

deploy_contest() {
    print_info "Deploying contest services..."
    docker compose -f docker-compose.contest.yml --env-file .env.contest up -d
    print_success "Contest services deployed"
    sleep 5
}

deploy_workers() {
    print_info "Deploying $NUM_WORKERS worker(s)..."
    for i in $(seq 0 $((NUM_WORKERS - 1))); do
        print_info "Deploying worker $i..."
        WORKER_SHARD=$i WORKER_NAME=worker-$i \
            docker compose -f docker-compose.worker.yml -p cms-worker-$i --env-file .env.worker up -d
    done
    print_success "$NUM_WORKERS worker(s) deployed"
}

case $DEPLOY_MODE in
    1)
        deploy_core
        deploy_admin
        deploy_contest
        deploy_workers
        ;;
    2)
        deploy_core
        ;;
    3)
        read -p "Deploy core services? (y/n) [y]: " DEPLOY_CORE
        [ "$DEPLOY_CORE" != "n" ] && deploy_core
        
        read -p "Deploy admin services? (y/n) [y]: " DEPLOY_ADMIN
        [ "$DEPLOY_ADMIN" != "n" ] && deploy_admin
        
        read -p "Deploy contest services? (y/n) [y]: " DEPLOY_CONTEST
        [ "$DEPLOY_CONTEST" != "n" ] && deploy_contest
        
        read -p "Deploy worker services? (y/n) [y]: " DEPLOY_WORKERS
        [ "$DEPLOY_WORKERS" != "n" ] && deploy_workers
        ;;
esac

# Initialize database
echo ""
print_step "Initializing database..."
print_info "Waiting for database to be ready..."
sleep 10

print_info "Running database initialization..."
docker exec cms-log-service cmsInitDB || print_warning "Database initialization may have failed. Check logs if issues occur."

# Summary
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                    Deployment Complete!                    ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""

print_success "CMS is now running!"
echo ""

print_info "Access your CMS installation:"
echo ""
if [ "$ACCESS_METHOD" = "public_port" ]; then
    echo "  📊 Contest Interface:  http://$PUBLIC_IP:$CONTEST_PORT"
    echo "  ⚙️  Admin Interface:   http://$PUBLIC_IP:$ADMIN_PORT"
    echo "  🏆 Ranking Interface:  http://$PUBLIC_IP:$RANKING_PORT"
    echo ""
    print_warning "Make sure firewall allows ports $CONTEST_PORT, $ADMIN_PORT, $RANKING_PORT"
    echo "  Run: sudo ufw allow $CONTEST_PORT/tcp"
    echo "       sudo ufw allow $ADMIN_PORT/tcp"
    echo "       sudo ufw allow $RANKING_PORT/tcp"
else
    echo "  📊 Contest Interface:  http://${CONTEST_DOMAIN}"
    echo "  ⚙️  Admin Interface:   http://${ADMIN_DOMAIN}"
    echo "  🏆 Ranking Interface:  http://${RANKING_DOMAIN}"
    echo ""
    print_warning "Make sure DNS is configured and reverse proxy is setup"
    echo "  See docs/ACCESS-CONFIGURATION.md for detailed instructions"
fi
echo ""

print_info "Configuration:"
echo "  Access Method: $ACCESS_METHOD"
echo "  Public IP: $PUBLIC_IP"
echo "  Database: $DB_NAME"
echo "  DB Username: $DB_USER"
echo "  DB Password: $DB_PASS"
echo "  Secret Key: $SECRET_KEY"
echo ""

print_info "Next steps:"
echo ""
echo "  1. Create an admin user:"
echo "     docker exec -it cms-admin-web-server cmsAddAdmin <username>"
echo ""
echo "  2. Import a contest:"
echo "     docker exec -it cms-admin-web-server cmsImportContest <contest-dir>"
echo ""
echo "  3. View logs:"
echo "     docker compose -f docker-compose.core.yml logs -f"
echo ""
echo "  4. Stop all services:"
echo "     ./scripts/stop-all.sh"
echo ""

print_info "Useful commands:"
echo "  - Check status: docker ps"
echo "  - View logs: docker logs <container-name>"
echo "  - Restart service: docker restart <container-name>"
echo ""

print_success "For detailed documentation, see README.md"
echo ""

# Save summary to file
cat > DEPLOYMENT-SUMMARY.txt << EOF
CMS Docker Deployment Summary
Generated: $(date)

Access Configuration:
  Method: $ACCESS_METHOD
  Public IP: $PUBLIC_IP

Database Configuration:
  Name: $DB_NAME
  User: $DB_USER
  Password: $DB_PASS

Access URLs:
EOF

if [ "$ACCESS_METHOD" = "public_port" ]; then
    cat >> DEPLOYMENT-SUMMARY.txt << EOF
  Contest: http://$PUBLIC_IP:$CONTEST_PORT
  Admin: http://$PUBLIC_IP:$ADMIN_PORT
  Ranking: http://$PUBLIC_IP:$RANKING_PORT

Firewall Configuration Required:
  sudo ufw allow $CONTEST_PORT/tcp
  sudo ufw allow $ADMIN_PORT/tcp
  sudo ufw allow $RANKING_PORT/tcp
EOF
else
    cat >> DEPLOYMENT-SUMMARY.txt << EOF
  Contest: http://${CONTEST_DOMAIN}
  Admin: http://${ADMIN_DOMAIN}
  Ranking: http://${RANKING_DOMAIN}

DNS Configuration Required:
  ${CONTEST_DOMAIN} → $PUBLIC_IP
  ${ADMIN_DOMAIN} → $PUBLIC_IP
  ${RANKING_DOMAIN} → $PUBLIC_IP
EOF
fi

cat >> DEPLOYMENT-SUMMARY.txt << EOF

Secret Key: $SECRET_KEY

Services Deployed:
  - Core Services: Yes
  - Admin Services: $([ "$DEPLOY_MODE" = "1" ] || [ "$DEPLOY_ADMIN" != "n" ] && echo "Yes" || echo "No")
  - Contest Services: $([ "$DEPLOY_MODE" = "1" ] || [ "$DEPLOY_CONTEST" != "n" ] && echo "Yes" || echo "No")
  - Workers: $([ "$DEPLOY_MODE" = "1" ] || [ "$DEPLOY_WORKERS" != "n" ] && echo "$NUM_WORKERS" || echo "0")

For more information, see:
  - Tutorial: docs/TUTORIAL.md
  - Full Guide: README.md
  - Access Config: docs/ACCESS-CONFIGURATION.md
EOF

print_success "Deployment summary saved to DEPLOYMENT-SUMMARY.txt"
echo ""
