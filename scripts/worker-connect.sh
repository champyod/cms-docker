#!/bin/bash

###############################################################################
# CMS Worker Auto-Connect Script
# Author: CCYod
# Repository: https://github.com/champyod/cms-docker
# 
# This script automatically connects a worker node to the CMS core services
###############################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}"
cat << "EOF"
   _____ __  __  _____   __          __        _             
  / ____|  \/  |/ ____| \ \        / /       | |            
 | |    | \  / | (___    \ \  /\  / /__  _ __| | _____ _ __ 
 | |    | |\/| |\___ \    \ \/  \/ / _ \| '__| |/ / _ \ '__|
 | |____| |  | |____) |    \  /\  / (_) | |  |   <  __/ |   
  \_____|_|  |_|_____/      \/  \/ \___/|_|  |_|\_\___|_|   
                                                             
         Auto-Connect Script for Remote Workers              
EOF
echo -e "${NC}"

# Function to print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root or with sudo"
    exit 1
fi

# Get user input
print_info "CMS Worker Connection Setup"
echo ""

# Core service host
read -p "Enter the CMS core services hostname/IP: " CORE_HOST
if [ -z "$CORE_HOST" ]; then
    print_error "Core host cannot be empty"
    exit 1
fi

# Worker shard number
read -p "Enter worker shard number (unique ID for this worker, e.g., 10, 11, 12...): " WORKER_SHARD
if [ -z "$WORKER_SHARD" ]; then
    WORKER_SHARD=10
    print_warning "Using default shard number: $WORKER_SHARD"
fi

# Worker name
read -p "Enter worker name (default: worker-$WORKER_SHARD): " WORKER_NAME
if [ -z "$WORKER_NAME" ]; then
    WORKER_NAME="worker-$WORKER_SHARD"
fi

# Installation directory
INSTALL_DIR="/opt/cms-worker"
read -p "Enter installation directory (default: $INSTALL_DIR): " INPUT_DIR
if [ ! -z "$INPUT_DIR" ]; then
    INSTALL_DIR="$INPUT_DIR"
fi

print_info "Configuration Summary:"
echo "  Core Host: $CORE_HOST"
echo "  Worker Shard: $WORKER_SHARD"
echo "  Worker Name: $WORKER_NAME"
echo "  Install Directory: $INSTALL_DIR"
echo ""

read -p "Continue with installation? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    print_warning "Installation cancelled"
    exit 0
fi

# Create installation directory
print_info "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Check for Docker
print_info "Checking for Docker..."
if ! command -v docker &> /dev/null; then
    print_warning "Docker not found. Installing Docker..."
    
    # Install Docker
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    
    # Start Docker service
    systemctl start docker
    systemctl enable docker
    
    print_success "Docker installed successfully"
else
    print_success "Docker is already installed"
fi

# Check for Docker Compose
print_info "Checking for Docker Compose..."
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_warning "Docker Compose not found. Installing Docker Compose..."
    
    # Install Docker Compose plugin
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
         -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    
    print_success "Docker Compose installed successfully"
else
    print_success "Docker Compose is already installed"
fi

# Download CMS configuration
print_info "Downloading CMS worker configuration..."

# Create config directory
mkdir -p "$INSTALL_DIR/config"

# Download configuration from core host
print_info "Fetching configuration from core host..."
if command -v curl &> /dev/null; then
    # Try to download config from core host (you may need to adjust this URL)
    curl -f "http://$CORE_HOST:8889/worker/config" -o "$INSTALL_DIR/config/cms.conf" 2>/dev/null || {
        print_warning "Could not download config from core host. Creating template..."
        
        # Create a template configuration
        cat > "$INSTALL_DIR/config/cms.conf" << EOFCONFIG
{
    "temp_dir": "/tmp",
    "backdoor": false,
    "cmsuser": "cmsuser",
    
    "core_services": {
        "LogService":         [["$CORE_HOST", 29000]],
        "ResourceService":    [["$CORE_HOST", 28000]],
        "ScoringService":     [["$CORE_HOST", 28500]],
        "Checker":            [["$CORE_HOST", 22000]],
        "EvaluationService":  [["$CORE_HOST", 25000]],
        "Worker":             [["0.0.0.0", 26000]],
        "ContestWebServer":   [["$CORE_HOST", 21000]],
        "AdminWebServer":     [["$CORE_HOST", 21100]],
        "ProxyService":       [["$CORE_HOST", 28600]],
        "PrintingService":    [["$CORE_HOST", 25123]]
    },
    
    "database": "postgresql+psycopg2://cmsuser:cmspassword@$CORE_HOST:5432/cmsdb",
    "database_debug": false,
    "twophase_commit": false,
    
    "keep_sandbox": false,
    "max_file_size": 1048576,
    
    "secret_key": "8e045a51e4b102ea803c06f92841a1fb"
}
EOFCONFIG
        
        print_warning "Template configuration created. Please update with actual values!"
    }
fi

# Create environment file
print_info "Creating environment configuration..."
cat > "$INSTALL_DIR/.env" << EOFENV
# CMS Worker Configuration
# Generated on $(date)

# Core Services Connection
CORE_SERVICES_HOST=$CORE_HOST

# Worker Configuration
WORKER_SHARD=$WORKER_SHARD
WORKER_NAME=$WORKER_NAME

# CMS Configuration File
CMS_CONFIG=/usr/local/etc/cms.conf

# Worker Resource Limits
WORKER_CPU_LIMIT=4
WORKER_MEMORY_LIMIT=4G
WORKER_CPU_RESERVATION=1
WORKER_MEMORY_RESERVATION=1G

# Sandbox Settings
KEEP_SANDBOX=false
MAX_FILE_SIZE=1048576

# Worker Replicas (for scaling)
WORKER_REPLICAS=1
EOFENV

# Create docker-compose file
print_info "Creating Docker Compose configuration..."
cat > "$INSTALL_DIR/docker-compose.yml" << 'EOFCOMPOSE'
version: '3.8'

services:
  worker:
    image: cms-worker:latest
    restart: unless-stopped
    environment:
      CMS_CONFIG: ${CMS_CONFIG:-/usr/local/etc/cms.conf}
      SERVICE_TYPE: Worker
      WORKER_SHARD: ${WORKER_SHARD:-0}
      CORE_SERVICES_HOST: ${CORE_SERVICES_HOST}
      KEEP_SANDBOX: ${KEEP_SANDBOX:-false}
      MAX_FILE_SIZE: ${MAX_FILE_SIZE:-1048576}
      WORKER_NAME: ${WORKER_NAME}
    volumes:
      - ./config/cms.conf:/usr/local/etc/cms.conf:ro
      - cms-logs:/var/local/log/cms
      - cms-cache:/var/local/cache/cms
      - cms-data:/var/local/lib/cms
      - worker-tmp:/tmp
    network_mode: host
    privileged: true
    security_opt:
      - seccomp:unconfined
      - apparmor:unconfined
    cap_add:
      - SYS_ADMIN
      - SYS_PTRACE
    command: >
      sh -c "sleep 5 && cmsWorker ${WORKER_SHARD:-0}"
    deploy:
      resources:
        limits:
          cpus: ${WORKER_CPU_LIMIT:-4}
          memory: ${WORKER_MEMORY_LIMIT:-4G}
        reservations:
          cpus: ${WORKER_CPU_RESERVATION:-1}
          memory: ${WORKER_MEMORY_RESERVATION:-1G}

volumes:
  cms-logs:
  cms-cache:
  cms-data:
  worker-tmp:
EOFCOMPOSE

# Pull/Build the Docker image
print_info "Preparing Docker image..."
print_warning "You need to either:"
echo "  1. Pull the image from a registry: docker pull your-registry/cms-worker:latest"
echo "  2. Build the image locally (requires CMS source code)"
echo ""
read -p "Do you want to build the image now? (y/n): " BUILD_IMAGE

if [ "$BUILD_IMAGE" = "y" ] || [ "$BUILD_IMAGE" = "Y" ]; then
    print_info "Please provide the path to CMS source code (with Dockerfile)..."
    read -p "CMS source path: " CMS_SOURCE
    
    if [ -d "$CMS_SOURCE" ] && [ -f "$CMS_SOURCE/Dockerfile" ]; then
        print_info "Building CMS worker image..."
        docker build -t cms-worker:latest "$CMS_SOURCE"
        print_success "Image built successfully"
    else
        print_error "Invalid CMS source path or Dockerfile not found"
        print_warning "You'll need to build or pull the image manually before starting the worker"
    fi
fi

# Create systemd service
print_info "Creating systemd service..."
cat > /etc/systemd/system/cms-worker.service << EOFSYSTEMD
[Unit]
Description=CMS Worker Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOFSYSTEMD

# Reload systemd
systemctl daemon-reload

print_success "Installation completed successfully!"
echo ""
print_info "Next steps:"
echo "  1. Review and update the configuration file: $INSTALL_DIR/config/cms.conf"
echo "  2. Review environment settings: $INSTALL_DIR/.env"
echo "  3. Ensure the Docker image is available (build or pull)"
echo "  4. Start the worker service: systemctl start cms-worker"
echo "  5. Enable auto-start on boot: systemctl enable cms-worker"
echo ""
print_info "Useful commands:"
echo "  - View worker status: systemctl status cms-worker"
echo "  - View worker logs: docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "  - Stop worker: systemctl stop cms-worker"
echo "  - Restart worker: systemctl restart cms-worker"
echo ""

read -p "Do you want to start the worker now? (y/n): " START_NOW
if [ "$START_NOW" = "y" ] || [ "$START_NOW" = "Y" ]; then
    print_info "Starting CMS worker..."
    systemctl start cms-worker
    systemctl enable cms-worker
    
    sleep 3
    systemctl status cms-worker
    
    print_success "Worker started successfully!"
else
    print_info "You can start the worker later with: systemctl start cms-worker"
fi

print_success "Setup complete! Worker $WORKER_NAME is ready."
