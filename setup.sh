#!/bin/bash

# ==============================================
# Contest Management System (CMS) - Docker Setup Script
# ==============================================
# Automated setup script for VPS deployment with Portainer
# Supports both standalone and distributed (Pi workers) setups

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_VERSION="1.0.0"
REPO_URL="https://github.com/your-username/cms-docker.git"
COMPOSE_VERSION="v2.20.0"
DOCKER_MIN_VERSION="20.10.0"

# Functions
print_header() {
    echo -e "${BLUE}"
    echo "=============================================="
    echo "   Contest Management System (CMS) Setup"
    echo "   Docker + Portainer Deployment v${SCRIPT_VERSION}"
    echo "=============================================="
    echo -e "${NC}"
}

print_step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Prompt for user input with validation
prompt_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    local validation="$4"
    
    while true; do
        if [ -n "$default" ]; then
            read -p "$(echo -e "${YELLOW}$prompt${NC} [$default]: ")" input
            eval "$var_name=\"\${input:-$default}\""
        else
            read -p "$(echo -e "${YELLOW}$prompt${NC}: ")" input
            eval "$var_name=\"$input\""
        fi
        
        if [ -z "$validation" ] || eval "$validation \"\$$var_name\""; then
            break
        else
            print_error "Invalid input. Please try again."
        fi
    done
}

# Validation functions
validate_ip() {
    local ip=$1
    if [[ $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        return 0
    else
        return 1
    fi
}

validate_port() {
    local port=$1
    if [[ $port =~ ^[0-9]+$ ]] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ]; then
        return 0
    else
        return 1
    fi
}

validate_non_empty() {
    local value=$1
    [ -n "$value" ]
}

# Check system requirements
check_requirements() {
    print_step "Checking system requirements..."
    
    # Check if running as root
    if [ "$EUID" -eq 0 ]; then
        print_error "Please do not run this script as root. Use a regular user with sudo privileges."
        exit 1
    fi
    
    # Check sudo privileges
    if ! sudo -n true 2>/dev/null; then
        print_error "This script requires sudo privileges. Please run: sudo -v"
        exit 1
    fi
    
    # Check OS
    if [[ "$OSTYPE" != "linux-gnu"* ]]; then
        print_error "This script is designed for Linux systems only."
        exit 1
    fi
    
    # Check architecture
    ARCH=$(uname -m)
    if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
        print_warning "Untested architecture: $ARCH. Continuing anyway..."
    fi
    
    # Check available memory
    MEMORY_GB=$(free -g | awk '/^Mem:/{print $2}')
    if [ "$MEMORY_GB" -lt 2 ]; then
        print_warning "Low memory detected (${MEMORY_GB}GB). CMS requires at least 2GB RAM for optimal performance."
    fi
    
    print_success "System requirements check completed."
}

# Install Docker if not present
install_docker() {
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        print_info "Docker already installed: v$DOCKER_VERSION"
        
        # Check Docker version
        if dpkg --compare-versions "$DOCKER_VERSION" "lt" "$DOCKER_MIN_VERSION"; then
            print_warning "Docker version $DOCKER_VERSION is older than recommended $DOCKER_MIN_VERSION"
        fi
        return 0
    fi
    
    print_step "Installing Docker..."
    
    # Update package index
    sudo apt-get update
    
    # Install prerequisites
    sudo apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Add Docker GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Add Docker repository
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Add user to docker group
    sudo usermod -aG docker $USER
    
    # Start and enable Docker
    sudo systemctl start docker
    sudo systemctl enable docker
    
    print_success "Docker installed successfully."
    print_warning "Please log out and log back in for Docker group membership to take effect."
}

# Install Docker Compose if not present
install_docker_compose() {
    if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
        print_info "Docker Compose already installed."
        return 0
    fi
    
    print_step "Installing Docker Compose..."
    
    # Download Docker Compose
    sudo curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    
    # Make executable
    sudo chmod +x /usr/local/bin/docker-compose
    
    print_success "Docker Compose installed successfully."
}

# Configure firewall
configure_firewall() {
    print_step "Configuring firewall..."
    
    # Check if ufw is available
    if ! command -v ufw &> /dev/null; then
        print_warning "UFW not found. Installing..."
        sudo apt-get update
        sudo apt-get install -y ufw
    fi
    
    # Configure firewall rules
    print_info "Opening required ports..."
    
    # SSH (make sure we don't lock ourselves out)
    sudo ufw allow ssh
    
    # Web interfaces
    sudo ufw allow ${CMS_CONTEST_PUBLIC_PORT}/tcp comment "CMS Contest Interface"
    sudo ufw allow ${CMS_ADMIN_PUBLIC_PORT}/tcp comment "CMS Admin Interface"
    sudo ufw allow ${CMS_RANKING_PUBLIC_PORT}/tcp comment "CMS Ranking Interface"
    
    # Database (for Pi workers)
    sudo ufw allow ${POSTGRES_PUBLIC_PORT}/tcp comment "PostgreSQL for Pi workers"
    
    # CMS Services (for Pi workers)
    sudo ufw allow ${CMS_LOG_SERVICE_PORT}/tcp comment "CMS LogService"
    sudo ufw allow ${CMS_RESOURCE_SERVICE_PORT}/tcp comment "CMS ResourceService"
    sudo ufw allow ${CMS_SCORING_SERVICE_PORT}/tcp comment "CMS ScoringService"
    sudo ufw allow ${CMS_EVALUATION_SERVICE_PORT}/tcp comment "CMS EvaluationService"
    sudo ufw allow ${CMS_PROXY_SERVICE_PORT}/tcp comment "CMS ProxyService"
    
    # Enable firewall if not already enabled
    if ! sudo ufw status | grep -q "Status: active"; then
        print_warning "Enabling UFW firewall..."
        sudo ufw --force enable
    fi
    
    print_success "Firewall configured successfully."
}

# Generate secure passwords and keys
generate_secrets() {
    print_step "Generating secure credentials..."
    
    # Generate database password
    if [ -z "$POSTGRES_PASSWORD" ]; then
        POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    fi
    
    # Generate CMS secret key
    if [ -z "$CMS_SECRET_KEY" ]; then
        CMS_SECRET_KEY=$(openssl rand -hex 16)
    fi
    
    # Generate ranking password
    if [ -z "$CMS_RANKING_PASSWORD" ]; then
        CMS_RANKING_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
    fi
    
    # Generate admin password
    if [ -z "$CMS_ADMIN_PASSWORD" ]; then
        CMS_ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
    fi
    
    print_success "Secure credentials generated."
}

# Create environment configuration
create_env_file() {
    print_step "Creating environment configuration..."
    
    cat > .env << EOF
# ==============================================
# CMS Docker Environment Configuration
# Generated by setup script on $(date)
# ==============================================

# ==============================================
# VPS Network Configuration
# ==============================================
VPS_PUBLIC_IP=$VPS_PUBLIC_IP
VPS_HOSTNAME=$VPS_PUBLIC_IP

# ==============================================
# Database Configuration
# ==============================================
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_PUBLIC_PORT=$POSTGRES_PUBLIC_PORT

# ==============================================
# CMS Core Configuration
# ==============================================
CMS_SECRET_KEY=$CMS_SECRET_KEY
CMS_TORNADO_DEBUG=false

# ==============================================
# Public Port Configuration
# ==============================================
CMS_CONTEST_PUBLIC_PORT=$CMS_CONTEST_PUBLIC_PORT
CMS_ADMIN_PUBLIC_PORT=$CMS_ADMIN_PUBLIC_PORT
CMS_RANKING_PUBLIC_PORT=$CMS_RANKING_PUBLIC_PORT

# ==============================================
# Service Authentication
# ==============================================
CMS_RANKING_USERNAME=$CMS_RANKING_USERNAME
CMS_RANKING_PASSWORD=$CMS_RANKING_PASSWORD
CMS_ADMIN_USERNAME=$CMS_ADMIN_USERNAME
CMS_ADMIN_PASSWORD=$CMS_ADMIN_PASSWORD

# ==============================================
# CMS Service Ports (for Raspberry Pi workers)
# ==============================================
CMS_LOG_SERVICE_PORT=$CMS_LOG_SERVICE_PORT
CMS_RESOURCE_SERVICE_PORT=$CMS_RESOURCE_SERVICE_PORT
CMS_SCORING_SERVICE_PORT=$CMS_SCORING_SERVICE_PORT
CMS_EVALUATION_SERVICE_PORT=$CMS_EVALUATION_SERVICE_PORT
CMS_PROXY_SERVICE_PORT=$CMS_PROXY_SERVICE_PORT

# ==============================================
# System Configuration
# ==============================================
CMS_NUM_WORKERS=$CMS_NUM_WORKERS
CMS_MAX_SUBMISSION_LENGTH=$CMS_MAX_SUBMISSION_LENGTH
CMS_MAX_INPUT_LENGTH=$CMS_MAX_INPUT_LENGTH

# ==============================================
# Optional Features
# ==============================================
USE_NGINX=$USE_NGINX
CMS_DOMAIN=$CMS_DOMAIN
HTTP_PORT=80
HTTPS_PORT=443

# ==============================================
# Storage Configuration
# ==============================================
CMS_LOG_DIR=/opt/cms/log
CMS_CACHE_DIR=/opt/cms/cache
CMS_DATA_DIR=/opt/cms/lib
CMS_RUN_DIR=/opt/cms/run
CMS_RANKING_LOG_DIR=/opt/cms/log/ranking
CMS_RANKING_LIB_DIR=/opt/cms/lib/ranking

EOF
    
    print_success "Environment file created: .env"
}

# Download or clone repository
setup_repository() {
    print_step "Setting up CMS Docker repository..."
    
    if [ ! -d ".git" ]; then
        print_info "Cloning repository..."
        git clone $REPO_URL /tmp/cms-docker-temp
        cp -r /tmp/cms-docker-temp/* .
        cp -r /tmp/cms-docker-temp/.* . 2>/dev/null || true
        rm -rf /tmp/cms-docker-temp
    else
        print_info "Repository already exists, pulling latest changes..."
        git pull origin main
    fi
    
    # Make scripts executable
    chmod +x scripts/*.sh
    chmod +x setup-raspberry-pi-worker.sh
    
    print_success "Repository setup completed."
}

# Build and test Docker images
build_images() {
    print_step "Building Docker images..."
    
    # Pull base images
    docker pull postgres:15-alpine
    docker pull nginx:alpine
    
    # Build CMS image
    if [ "$BUILD_IMAGES" == "true" ]; then
        print_info "Building CMS Docker image (this may take several minutes)..."
        docker-compose build --no-cache
    else
        print_info "Skipping image build (will be built on first deployment)"
    fi
    
    print_success "Docker images prepared."
}

# Create management scripts
create_management_scripts() {
    print_step "Creating management scripts..."
    
    # CMS management script
    cat > cms-manage << 'EOF'
#!/bin/bash

case "$1" in
    start)
        echo "Starting CMS services..."
        docker-compose up -d
        ;;
    stop)
        echo "Stopping CMS services..."
        docker-compose down
        ;;
    restart)
        echo "Restarting CMS services..."
        docker-compose restart
        ;;
    logs)
        docker-compose logs -f ${2:-}
        ;;
    status)
        docker-compose ps
        ;;
    backup)
        BACKUP_FILE="cms-backup-$(date +%Y%m%d-%H%M%S).sql"
        echo "Creating database backup: $BACKUP_FILE"
        docker exec cms-postgres pg_dump -U cmsuser cmsdb > "$BACKUP_FILE"
        echo "Backup completed: $BACKUP_FILE"
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "Usage: $0 restore <backup-file>"
            exit 1
        fi
        echo "Restoring database from: $2"
        docker exec -i cms-postgres psql -U cmsuser cmsdb < "$2"
        echo "Restore completed"
        ;;
    update)
        echo "Updating CMS..."
        git pull origin main
        docker-compose build
        docker-compose up -d
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|logs|status|backup|restore|update}"
        echo ""
        echo "Commands:"
        echo "  start     - Start all CMS services"
        echo "  stop      - Stop all CMS services" 
        echo "  restart   - Restart all CMS services"
        echo "  logs      - View logs (optionally specify service name)"
        echo "  status    - Show service status"
        echo "  backup    - Create database backup"
        echo "  restore   - Restore database from backup file"
        echo "  update    - Update CMS and restart services"
        exit 1
        ;;
esac
EOF
    
    chmod +x cms-manage
    
    # Portainer deployment script
    cat > deploy-to-portainer.sh << 'EOF'
#!/bin/bash

echo "==================================="
echo "CMS Portainer Deployment Guide"
echo "==================================="
echo ""
echo "To deploy CMS in Portainer:"
echo ""
echo "1. Open your Portainer interface"
echo "2. Navigate to 'Stacks' → 'Add stack'"
echo "3. Choose 'Git Repository' method"
echo "4. Enter repository URL: https://github.com/your-username/cms-docker.git"
echo "5. Set compose path: docker-compose.yml"
echo "6. Add the following environment variables:"
echo ""

cat .env | grep -v '^#' | grep -v '^$' | while read line; do
    echo "   $line"
done

echo ""
echo "7. Click 'Deploy the stack'"
echo ""
echo "After deployment, access your CMS at:"
echo "  Contest:  http://${VPS_PUBLIC_IP}:${CMS_CONTEST_PUBLIC_PORT}"
echo "  Admin:    http://${VPS_PUBLIC_IP}:${CMS_ADMIN_PUBLIC_PORT}"
echo "  Ranking:  http://${VPS_PUBLIC_IP}:${CMS_RANKING_PUBLIC_PORT}"
echo ""
EOF
    
    chmod +x deploy-to-portainer.sh
    
    print_success "Management scripts created."
}

# Test deployment
test_deployment() {
    if [ "$SKIP_TEST" == "true" ]; then
        print_info "Skipping deployment test."
        return 0
    fi
    
    print_step "Testing deployment..."
    
    # Start services
    docker-compose up -d
    
    # Wait for services to start
    print_info "Waiting for services to start..."
    sleep 30
    
    # Check service health
    if docker-compose ps | grep -q "Up"; then
        print_success "Services started successfully."
        
        # Test web interfaces
        print_info "Testing web interfaces..."
        
        if curl -f http://localhost:${CMS_CONTEST_PUBLIC_PORT}/ >/dev/null 2>&1; then
            print_success "Contest interface is accessible."
        else
            print_warning "Contest interface test failed (this may be normal during initial setup)."
        fi
        
        # Stop test deployment
        docker-compose down
    else
        print_error "Some services failed to start. Check logs with: docker-compose logs"
        return 1
    fi
}

# Generate summary report
generate_summary() {
    print_step "Generating deployment summary..."
    
    cat > DEPLOYMENT-SUMMARY.md << EOF
# CMS Deployment Summary

**Generated on**: $(date)
**VPS IP**: $VPS_PUBLIC_IP

## Access Information

### Web Interfaces
- **Contest Interface**: http://$VPS_PUBLIC_IP:$CMS_CONTEST_PUBLIC_PORT
- **Admin Interface**: http://$VPS_PUBLIC_IP:$CMS_ADMIN_PUBLIC_PORT
- **Ranking Interface**: http://$VPS_PUBLIC_IP:$CMS_RANKING_PUBLIC_PORT

### Admin Credentials
- **Username**: $CMS_ADMIN_USERNAME
- **Password**: $CMS_ADMIN_PASSWORD

### Ranking Credentials
- **Username**: $CMS_RANKING_USERNAME
- **Password**: $CMS_RANKING_PASSWORD

## Database Information
- **Database**: $POSTGRES_DB
- **User**: $POSTGRES_USER
- **Password**: $POSTGRES_PASSWORD
- **Port**: $POSTGRES_PUBLIC_PORT

## Management Commands

### Local Management
\`\`\`bash
./cms-manage start     # Start services
./cms-manage stop      # Stop services
./cms-manage status    # Check status
./cms-manage logs      # View logs
./cms-manage backup    # Backup database
\`\`\`

### Portainer Deployment
\`\`\`bash
./deploy-to-portainer.sh  # Show Portainer setup guide
\`\`\`

## Raspberry Pi Workers

To add Raspberry Pi workers:
\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/your-username/cms-docker/main/setup-raspberry-pi-worker.sh | sudo bash
\`\`\`

Use these settings:
- **VPS IP**: $VPS_PUBLIC_IP
- **Database Name**: $POSTGRES_DB
- **Database User**: $POSTGRES_USER
- **Database Password**: $POSTGRES_PASSWORD

## Security Notes

- All passwords have been automatically generated
- Firewall has been configured with required ports
- Change default passwords before production use
- Consider using SSL/TLS for production deployments

## Next Steps

1. Deploy to Portainer using \`./deploy-to-portainer.sh\`
2. Access admin interface and create your first contest
3. Add Raspberry Pi workers if needed
4. Configure your contest problems and participants

## Support

- Documentation: See README.md
- Issues: GitHub Issues
- Community: CMS Telegram group

EOF
    
    print_success "Deployment summary created: DEPLOYMENT-SUMMARY.md"
}

# Main installation process
main() {
    print_header
    
    # Configuration collection
    print_step "Configuration Setup"
    
    # Get VPS IP
    while true; do
        prompt_input "Enter your VPS public IP address" "" "VPS_PUBLIC_IP" "validate_ip"
        break
    done
    
    # Database configuration
    prompt_input "Database name" "cmsdb" "POSTGRES_DB" "validate_non_empty"
    prompt_input "Database username" "cmsuser" "POSTGRES_USER" "validate_non_empty"
    prompt_input "Database port" "5432" "POSTGRES_PUBLIC_PORT" "validate_port"
    
    # Web interface ports
    prompt_input "Contest interface port" "8888" "CMS_CONTEST_PUBLIC_PORT" "validate_port"
    prompt_input "Admin interface port" "8889" "CMS_ADMIN_PUBLIC_PORT" "validate_port"
    prompt_input "Ranking interface port" "8890" "CMS_RANKING_PUBLIC_PORT" "validate_port"
    
    # Service ports
    prompt_input "LogService port" "29000" "CMS_LOG_SERVICE_PORT" "validate_port"
    prompt_input "ResourceService port" "28000" "CMS_RESOURCE_SERVICE_PORT" "validate_port"
    prompt_input "ScoringService port" "28500" "CMS_SCORING_SERVICE_PORT" "validate_port"
    prompt_input "EvaluationService port" "25000" "CMS_EVALUATION_SERVICE_PORT" "validate_port"
    prompt_input "ProxyService port" "28600" "CMS_PROXY_SERVICE_PORT" "validate_port"
    
    # Admin credentials
    prompt_input "Admin username" "admin" "CMS_ADMIN_USERNAME" "validate_non_empty"
    prompt_input "Ranking username" "admin" "CMS_RANKING_USERNAME" "validate_non_empty"
    
    # System configuration
    prompt_input "Number of workers on VPS" "1" "CMS_NUM_WORKERS"
    prompt_input "Maximum submission size (bytes)" "100000" "CMS_MAX_SUBMISSION_LENGTH"
    prompt_input "Maximum input size (bytes)" "5000000" "CMS_MAX_INPUT_LENGTH"
    
    # Domain configuration
    prompt_input "Use nginx reverse proxy (future domain support)" "false" "USE_NGINX"
    prompt_input "Domain name (for future use)" "localhost" "CMS_DOMAIN"
    
    # Installation options
    echo ""
    print_info "Installation Options:"
    prompt_input "Build Docker images now? (slower but tests build)" "false" "BUILD_IMAGES"
    prompt_input "Test deployment after setup?" "true" "TEST_DEPLOYMENT"
    prompt_input "Skip test deployment?" "false" "SKIP_TEST"
    
    echo ""
    print_info "Configuration completed. Starting installation..."
    echo ""
    
    # Execute installation steps
    check_requirements
    install_docker
    install_docker_compose
    generate_secrets
    setup_repository
    create_env_file
    configure_firewall
    build_images
    create_management_scripts
    
    if [ "$TEST_DEPLOYMENT" == "true" ]; then
        test_deployment
    fi
    
    generate_summary
    
    # Final instructions
    echo ""
    print_success "=============================================="
    print_success "   CMS Docker Setup Completed Successfully!"
    print_success "=============================================="
    echo ""
    print_info "Next Steps:"
    echo "1. Review deployment summary: cat DEPLOYMENT-SUMMARY.md"
    echo "2. Deploy to Portainer: ./deploy-to-portainer.sh"
    echo "3. Access admin interface: http://$VPS_PUBLIC_IP:$CMS_ADMIN_PUBLIC_PORT"
    echo ""
    print_info "Management Commands:"
    echo "./cms-manage start     # Start services locally"
    echo "./cms-manage status    # Check service status"
    echo "./cms-manage logs      # View service logs"
    echo ""
    print_warning "Important: Review and secure your credentials in .env file"
    echo ""
    print_success "Happy contest organizing! 🏆"
}

# Script execution
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi
