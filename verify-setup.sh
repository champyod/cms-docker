#!/bin/bash

# Quick verification script to check if setup was successful

echo "==================================="
echo "CMS Docker Setup Verification"
echo "Docker deployment solution by CCYod"
echo "==================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 exists"
        return 0
    else
        echo -e "${RED}✗${NC} $1 missing"
        return 1
    fi
}

check_executable() {
    if [ -x "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 is executable"
        return 0
    else
        echo -e "${RED}✗${NC} $1 is not executable"
        return 1
    fi
}

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 is installed"
        return 0
    else
        echo -e "${RED}✗${NC} $1 is not installed"
        return 1
    fi
}

echo "Checking required files..."
check_file "docker-compose.yml"
check_file "docker-compose.vps.yml"
check_file ".env.sample"
check_file "setup.sh"
check_file "setup-raspberry-pi-worker.sh"
check_file "VPS-DEPLOYMENT.md"
check_file "PORTAINER-DEPLOYMENT.md"

echo ""
echo "Checking scripts..."
check_executable "setup.sh"
check_executable "setup-raspberry-pi-worker.sh"
check_executable "scripts/start-cms.sh"
check_executable "scripts/start-ranking.sh"
check_executable "scripts/init-db.sh"

echo ""
echo "Checking system requirements..."
check_command "docker"
check_command "docker-compose"
check_command "git"
check_command "curl"

echo ""
echo "Checking configuration files..."
check_file "nginx/nginx.conf.template"
check_file "scripts/start-cms.sh"
check_file "scripts/start-ranking.sh"

echo ""
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} Environment file (.env) configured"
    echo -e "${YELLOW}ℹ${NC} Ready for deployment!"
else
    echo -e "${YELLOW}!${NC} Environment file (.env) not found"
    echo -e "${YELLOW}ℹ${NC} Run ./setup.sh to configure"
fi

echo ""
echo "==================================="
echo "Next steps:"
echo "1. Run ./setup.sh for automated setup"
echo "2. Or manually copy .env.sample to .env and configure"
echo "3. Deploy using Portainer or docker-compose"
echo "==================================="
