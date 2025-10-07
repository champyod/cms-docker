#!/bin/bash

# ==============================================
# CMS Raspberry Pi Worker Setup Script
# ==============================================
# This script sets up a Raspberry Pi as a CMS worker
# that connects to the main VPS server

set -e

echo "======================================"
echo "CMS Raspberry Pi Worker Setup"
echo "======================================"

# Function to prompt for user input
prompt_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    
    if [ -n "$default" ]; then
        read -p "$prompt [$default]: " input
        eval "$var_name=\"\${input:-$default}\""
    else
        read -p "$prompt: " input
        eval "$var_name=\"$input\""
    fi
}

# Function to validate IP address
validate_ip() {
    local ip=$1
    if [[ $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        return 0
    else
        return 1
    fi
}

# Get configuration from user
echo ""
echo "Please provide the following information:"
echo ""

# VPS Configuration
while true; do
    prompt_input "VPS Public IP address" "" "VPS_IP"
    if validate_ip "$VPS_IP"; then
        break
    else
        echo "Error: Invalid IP address format. Please try again."
    fi
done

prompt_input "VPS Database Port" "5432" "VPS_DB_PORT"
prompt_input "Database Name" "cmsdb" "DB_NAME"
prompt_input "Database Username" "cmsuser" "DB_USER"
prompt_input "Database Password" "" "DB_PASSWORD"

# Worker Configuration
prompt_input "Worker ID (unique number for this Pi)" "1" "WORKER_ID"
prompt_input "Worker Port" "$((26000 + WORKER_ID))" "WORKER_PORT"
prompt_input "Worker Name" "raspberrypi-worker-$WORKER_ID" "WORKER_NAME"

# Service Configuration
prompt_input "LogService Port on VPS" "29000" "LOG_SERVICE_PORT"
prompt_input "ResourceService Port on VPS" "28000" "RESOURCE_SERVICE_PORT"
prompt_input "ScoringService Port on VPS" "28500" "SCORING_SERVICE_PORT"
prompt_input "EvaluationService Port on VPS" "25000" "EVALUATION_SERVICE_PORT"

echo ""
echo "======================================"
echo "Configuration Summary:"
echo "======================================"
echo "VPS IP: $VPS_IP"
echo "Database: $DB_USER@$VPS_IP:$VPS_DB_PORT/$DB_NAME"
echo "Worker: $WORKER_NAME (ID: $WORKER_ID, Port: $WORKER_PORT)"
echo ""

read -p "Continue with installation? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation cancelled."
    exit 1
fi

echo ""
echo "======================================"
echo "Installing Dependencies..."
echo "======================================"

# Update system
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install required packages
echo "Installing required packages..."
sudo apt install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    build-essential \
    libpq-dev \
    postgresql-client \
    git \
    curl \
    isolate

# Setup isolate
echo "Configuring isolate sandbox..."
sudo sed -i 's@^cg_root .*@cg_root = /sys/fs/cgroup@' /etc/isolate || true

# Create CMS user
echo "Creating CMS user..."
sudo useradd -m -s /bin/bash cmsworker || true
sudo usermod -aG isolate cmsworker || true

echo ""
echo "======================================"
echo "Installing CMS..."
echo "======================================"

# Switch to CMS user for installation
sudo -u cmsworker bash << EOFCMS
cd /home/cmsworker

# Clone CMS repository
if [ ! -d "cms" ]; then
    git clone https://github.com/cms-dev/cms.git
    cd cms
else
    cd cms
    git pull
fi

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install CMS
pip install -e .

# Create configuration directory
mkdir -p /home/cmsworker/cms-config

EOFCMS

echo ""
echo "======================================"
echo "Generating Configuration..."
echo "======================================"

# Generate CMS configuration file
sudo -u cmsworker tee /home/cmsworker/cms-config/cms.toml > /dev/null << EOFCONFIG
[global]
backdoor = false
file_log_debug = true
stream_log_detailed = false

temp_dir = "/tmp"
log_dir = "/home/cmsworker/cms-logs"
cache_dir = "/home/cmsworker/cms-cache" 
data_dir = "/home/cmsworker/cms-data"
run_dir = "/home/cmsworker/cms-run"

[database]
url = "postgresql+psycopg2://${DB_USER}:${DB_PASSWORD}@${VPS_IP}:${VPS_DB_PORT}/${DB_NAME}"
debug = false
twophase_commit = false

[services]
# Connect to services on main VPS
LogService = [["${VPS_IP}", ${LOG_SERVICE_PORT}]]
ResourceService = [["${VPS_IP}", ${RESOURCE_SERVICE_PORT}]]
ScoringService = [["${VPS_IP}", ${SCORING_SERVICE_PORT}]]
EvaluationService = [["${VPS_IP}", ${EVALUATION_SERVICE_PORT}]]

# This worker configuration
Worker = [
    ["0.0.0.0", ${WORKER_PORT}]
]

[worker]
keep_sandbox = false

[sandbox]
sandbox_implementation = "isolate"
max_file_size = 1048576
compilation_sandbox_max_processes = 1000
compilation_sandbox_max_time_s = 10.0
compilation_sandbox_max_memory_kib = 524288
trusted_sandbox_max_processes = 1000
trusted_sandbox_max_time_s = 10.0
trusted_sandbox_max_memory_kib = 2097152

EOFCONFIG

# Create required directories
sudo -u cmsworker mkdir -p /home/cmsworker/{cms-logs,cms-cache,cms-data,cms-run}

echo ""
echo "======================================"
echo "Creating Startup Script..."
echo "======================================"

# Create startup script
sudo -u cmsworker tee /home/cmsworker/start-worker.sh > /dev/null << 'EOFSTARTUP'
#!/bin/bash

set -e

echo "Starting CMS Worker..."

# Activate virtual environment
cd /home/cmsworker/cms
source venv/bin/activate

# Set configuration path
export CMS_CONFIG="/home/cmsworker/cms-config/cms.toml"

# Wait for database connection
echo "Waiting for database connection..."
until pg_isready -h VPS_IP -p VPS_DB_PORT -U DB_USER; do
    echo "Database not ready, waiting..."
    sleep 5
done

echo "Database connected successfully!"

# Start the worker
echo "Starting Worker ID WORKER_ID on port WORKER_PORT..."
exec cmsWorker WORKER_ID

EOFSTARTUP

# Replace placeholders in startup script
sudo -u cmsworker sed -i "s/VPS_IP/$VPS_IP/g" /home/cmsworker/start-worker.sh
sudo -u cmsworker sed -i "s/VPS_DB_PORT/$VPS_DB_PORT/g" /home/cmsworker/start-worker.sh
sudo -u cmsworker sed -i "s/DB_USER/$DB_USER/g" /home/cmsworker/start-worker.sh
sudo -u cmsworker sed -i "s/WORKER_ID/$WORKER_ID/g" /home/cmsworker/start-worker.sh
sudo -u cmsworker sed -i "s/WORKER_PORT/$WORKER_PORT/g" /home/cmsworker/start-worker.sh

# Make startup script executable
sudo chmod +x /home/cmsworker/start-worker.sh

echo ""
echo "======================================"
echo "Creating Systemd Service..."
echo "======================================"

# Create systemd service
sudo tee /etc/systemd/system/cms-worker.service > /dev/null << EOFSERVICE
[Unit]
Description=CMS Worker $WORKER_ID
After=network.target

[Service]
Type=simple
User=cmsworker
Group=cmsworker
WorkingDirectory=/home/cmsworker
ExecStart=/home/cmsworker/start-worker.sh
Restart=always
RestartSec=10
Environment=CMS_CONFIG=/home/cmsworker/cms-config/cms.toml

[Install]
WantedBy=multi-user.target
EOFSERVICE

# Reload systemd and enable service
sudo systemctl daemon-reload
sudo systemctl enable cms-worker

echo ""
echo "======================================"
echo "Creating Helper Scripts..."
echo "======================================"

# Create management scripts
sudo tee /usr/local/bin/cms-worker-start > /dev/null << 'EOFSTART'
#!/bin/bash
echo "Starting CMS Worker..."
sudo systemctl start cms-worker
sudo systemctl status cms-worker
EOFSTART

sudo tee /usr/local/bin/cms-worker-stop > /dev/null << 'EOFSTOP'
#!/bin/bash
echo "Stopping CMS Worker..."
sudo systemctl stop cms-worker
EOFSTOP

sudo tee /usr/local/bin/cms-worker-restart > /dev/null << 'EOFRESTART'
#!/bin/bash
echo "Restarting CMS Worker..."
sudo systemctl restart cms-worker
sudo systemctl status cms-worker
EOFRESTART

sudo tee /usr/local/bin/cms-worker-logs > /dev/null << 'EOFLOGS'
#!/bin/bash
echo "CMS Worker Logs:"
sudo journalctl -u cms-worker -f
EOFLOGS

sudo tee /usr/local/bin/cms-worker-status > /dev/null << 'EOFSTATUS'
#!/bin/bash
echo "CMS Worker Status:"
sudo systemctl status cms-worker
echo ""
echo "Recent logs:"
sudo journalctl -u cms-worker --no-pager -n 20
EOFSTATUS

# Make helper scripts executable
sudo chmod +x /usr/local/bin/cms-worker-*

echo ""
echo "======================================"
echo "Installation Complete!"
echo "======================================"
echo ""
echo "Worker Configuration:"
echo "  Name: $WORKER_NAME"
echo "  ID: $WORKER_ID"
echo "  Port: $WORKER_PORT"
echo "  VPS: $VPS_IP"
echo ""
echo "Management Commands:"
echo "  cms-worker-start    - Start the worker"
echo "  cms-worker-stop     - Stop the worker"
echo "  cms-worker-restart  - Restart the worker"
echo "  cms-worker-status   - Check worker status"
echo "  cms-worker-logs     - View real-time logs"
echo ""
echo "Configuration files:"
echo "  Config: /home/cmsworker/cms-config/cms.toml"
echo "  Startup: /home/cmsworker/start-worker.sh"
echo "  Service: /etc/systemd/system/cms-worker.service"
echo ""
echo "Next steps:"
echo "1. Ensure the VPS is running and accessible"
echo "2. Verify database connectivity: pg_isready -h $VPS_IP -p $VPS_DB_PORT -U $DB_USER"
echo "3. Start the worker: cms-worker-start"
echo "4. Check status: cms-worker-status"
echo ""
echo "IMPORTANT: Make sure the VPS firewall allows connections on:"
echo "  - Port $VPS_DB_PORT (PostgreSQL)"
echo "  - Port $LOG_SERVICE_PORT (LogService)"
echo "  - Port $RESOURCE_SERVICE_PORT (ResourceService)"
echo "  - Port $SCORING_SERVICE_PORT (ScoringService)"
echo "  - Port $EVALUATION_SERVICE_PORT (EvaluationService)"
echo ""

read -p "Would you like to start the worker now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Starting CMS Worker..."
    cms-worker-start
else
    echo "You can start the worker later with: cms-worker-start"
fi

echo ""
echo "Setup completed successfully!"
