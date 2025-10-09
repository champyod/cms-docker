# CMS Docker - Complete Setup Guide

<!--
Author: CCYod
Repository: https://github.com/champyod/cms-docker
-->

This comprehensive guide covers all setup methods for deploying CMS using Docker.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Automated Setup](#automated-setup)
- [Manual Setup](#manual-setup)
- [Portainer Setup](#portainer-setup)
- [Configuration](#configuration)
- [Scaling](#scaling)
- [Multiple Contests](#multiple-contests)
- [Production Deployment](#production-deployment)

---

## Prerequisites

### Software Requirements

- **Docker**: 20.10 or higher
- **Docker Compose**: 2.0 or higher (included with Docker Desktop)
- **Operating System**: Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+, or similar)
- **Git**: For cloning the repository

### Hardware Requirements

**Minimum (Development/Testing):**
- CPU: 4 cores
- RAM: 8 GB
- Storage: 20 GB
- Network: 100 Mbps

**Recommended (Production):**
- CPU: 8+ cores (16+ for large contests)
- RAM: 16+ GB (32+ for large contests)
- Storage: 100+ GB SSD
- Network: 1 Gbps

**Per Additional Worker:**
- CPU: 2-4 cores
- RAM: 2-4 GB
- Storage: 10 GB

### Network Requirements

**Required Ports:**
- 8888: Contest Web Interface (contestants)
- 8889: Admin Web Interface (organizers)
- 8890: Ranking Web Interface (public)
- 5432: PostgreSQL (internal, can be blocked externally)
- 9000/9443: Portainer (if using Portainer)

**For Remote Workers:**
- 22000: LogService
- 25000: ResourceService
- 28000: ScoringService
- 28500: Checker
- 28600: EvaluationService
- 29000: ProxyService

### Initial Setup

```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (optional, avoids using sudo)
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose (if not included)
sudo apt-get install docker-compose-plugin -y

# Verify installations
docker --version
docker compose version
```

---

## Quick Start

The fastest way to get CMS running:

```bash
# 1. Clone repository
git clone https://github.com/CCYod/cms-docker.git
cd cms-docker

# 2. Run automated setup
./scripts/quick-start.sh
```

The script will:
- ✅ Prompt for access method (Public IP or Domain)
- ✅ Auto-detect your public IP
- ✅ Generate environment files
- ✅ Build Docker images
- ✅ Deploy all stacks
- ✅ Initialize database
- ✅ Prompt to create admin user

**Setup time: ~5 minutes**

After completion:
- Contest: `http://YOUR_IP:8888`
- Admin: `http://YOUR_IP:8889`
- Ranking: `http://YOUR_IP:8890`

---

## Automated Setup

### Using quick-start.sh

This is the recommended method for most users:

```bash
cd cms-docker
./scripts/quick-start.sh
```

**Interactive Prompts:**

1. **Access Method:**
   ```
   How will users access your CMS?
   1) Public IP + Ports (e.g., http://1.2.3.4:8888) - No domain required
   2) Domain Names (e.g., http://contest.example.com) - Requires DNS setup
   ```
   Choose based on your setup.

2. **Public IP (if method 1):**
   - Script auto-detects your public IP
   - Confirm or enter manually

3. **Database Configuration:**
   - Database name (default: `cmsdb`)
   - Database user (default: `cmsuser`)
   - Database password (enter secure password)

4. **Port Configuration:**
   - Contest port (default: `8888`)
   - Admin port (default: `8889`)
   - Ranking port (default: `8890`)

5. **Contest Configuration:**
   - Contest ID (default: `1`)
   - Secret key (auto-generated)

**What the script does:**

```bash
# 1. Creates network
docker network create cms-network

# 2. Generates .env files
# .env.core, .env.admin, .env.contest, .env.worker

# 3. Builds CMS image
docker build -t cms:latest .

# 4. Deploys core services
docker compose -f docker-compose.core.yml up -d

# 5. Waits for database
sleep 30

# 6. Initializes database
docker exec cms-log-service cmsInitDB

# 7. Deploys admin, contest, worker stacks
docker compose -f docker-compose.admin.yml up -d
docker compose -f docker-compose.contest.yml up -d
docker compose -f docker-compose.worker.yml up -d

# 8. Prompts for admin user creation
```

### Firewall Configuration

The script will remind you to configure your firewall:

```bash
# UFW (Ubuntu/Debian)
sudo ufw allow 8888/tcp
sudo ufw allow 8889/tcp
sudo ufw allow 8890/tcp
sudo ufw reload

# firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=8888/tcp
sudo firewall-cmd --permanent --add-port=8889/tcp
sudo firewall-cmd --permanent --add-port=8890/tcp
sudo firewall-cmd --reload
```

---

## Manual Setup

For users who want full control:

### Step 1: Clone Repository

```bash
git clone https://github.com/CCYod/cms-docker.git
cd cms-docker
```

### Step 2: Create Network

```bash
docker network create cms-network
```

### Step 3: Configure Environment Files

Create and edit `.env` files for each stack:

**Core Services (.env.core):**

```bash
cp .env.core .env

# Edit with your values
nano .env
```

Required variables:
```bash
# Server Configuration
PUBLIC_IP=your.server.ip.address

# Database Configuration
POSTGRES_DB=cmsdb
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=your_secure_password_here

# Service Shards (usually 0)
LOG_SERVICE_SHARD=0
RESOURCE_SERVICE_SHARD=0
SCORING_SERVICE_SHARD=0
```

**Admin Services (.env.admin):**

```bash
cp .env.admin .env.admin.local
nano .env.admin.local
```

```bash
# Access Configuration
ACCESS_METHOD=public_port  # or 'domain'
PUBLIC_IP=your.server.ip.address

# Ports
ADMIN_PORT_EXTERNAL=8889
RANKING_PORT_EXTERNAL=8890

# Domain Configuration (if ACCESS_METHOD=domain)
ADMIN_DOMAIN=admin.example.com
RANKING_DOMAIN=ranking.example.com
```

**Contest Services (.env.contest):**

```bash
cp .env.contest .env.contest.local
nano .env.contest.local
```

```bash
# Access Configuration
ACCESS_METHOD=public_port
PUBLIC_IP=your.server.ip.address

# Contest Configuration
CONTEST_ID=1
CONTEST_PORT_EXTERNAL=8888

# Security
SECRET_KEY=$(openssl rand -hex 32)

# Domain Configuration (if ACCESS_METHOD=domain)
CONTEST_DOMAIN=contest.example.com
```

**Worker Services (.env.worker):**

```bash
cp .env.worker .env.worker.local
nano .env.worker.local
```

```bash
# Worker Configuration
WORKER_SHARD=0
WORKER_NAME=worker-0

# Core Services Connection
# For local workers: use container name
CORE_SERVICES_HOST=cms-log-service

# For remote workers: use public IP
# CORE_SERVICES_HOST=your.server.ip.address

# Resource Limits
WORKER_CPUS=2
WORKER_MEMORY=2g
```

### Step 4: Build Docker Image

```bash
docker build -t cms:latest .
```

This may take 10-15 minutes.

### Step 5: Deploy Core Stack

```bash
docker compose -f docker-compose.core.yml --env-file .env up -d
```

Wait for services to be healthy:
```bash
docker ps --filter "name=cms-" --format "table {{.Names}}\t{{.Status}}"
```

### Step 6: Initialize Database

```bash
# Wait for database to be ready
docker exec cms-database pg_isready -U cmsuser

# Initialize CMS database
docker exec cms-log-service cmsInitDB
```

Expected output:
```
Creating tables and indexes...
Done.
```

### Step 7: Deploy Admin Stack

```bash
docker compose -f docker-compose.admin.yml --env-file .env.admin.local up -d
```

### Step 8: Create Admin User

```bash
docker exec -it cms-admin-web-server cmsAddAdmin yourusername
```

Enter password when prompted.

### Step 9: Deploy Contest Stack

```bash
docker compose -f docker-compose.contest.yml --env-file .env.contest.local up -d
```

### Step 10: Deploy Worker Stack

```bash
docker compose -f docker-compose.worker.yml --env-file .env.worker.local up -d
```

### Step 11: Verify Deployment

```bash
# Check all containers
docker ps --filter "name=cms-"

# Check logs
docker logs cms-contest-web-server-1
docker logs cms-admin-web-server
docker logs cms-worker

# Test access
curl http://YOUR_IP:8888
curl http://YOUR_IP:8889
curl http://YOUR_IP:8890
```

---

## Portainer Setup

See **[PORTAINER-GUIDE.md](PORTAINER-GUIDE.md)** for comprehensive Portainer deployment instructions with screenshots.

Quick summary:

1. **Install Portainer** (if needed)
2. **Access Portainer UI** at `http://your-server:9000`
3. **Deploy stacks** via UI:
   - Upload docker-compose files
   - Add environment variables
   - Deploy
4. **Manage containers** via web interface

---

## Configuration

### Access Methods

#### Public IP + Ports

Best for: Development, testing, VPS without domain

```bash
ACCESS_METHOD=public_port
PUBLIC_IP=your.server.ip
CONTEST_PORT_EXTERNAL=8888
ADMIN_PORT_EXTERNAL=8889
RANKING_PORT_EXTERNAL=8890
```

Access URLs:
- Contest: `http://your.server.ip:8888`
- Admin: `http://your.server.ip:8889`
- Ranking: `http://your.server.ip:8890`

#### Domain-Based

Best for: Production, HTTPS

```bash
ACCESS_METHOD=domain
CONTEST_DOMAIN=contest.example.com
ADMIN_DOMAIN=admin.example.com
RANKING_DOMAIN=ranking.example.com
```

Requires:
- DNS A records pointing to your server
- Reverse proxy (Nginx/Traefik)
- SSL/TLS certificates

See [ACCESS-CONFIGURATION.md](ACCESS-CONFIGURATION.md) for details.

### Security Configuration

#### Database Passwords

```bash
# Generate strong password
openssl rand -base64 32

# Set in .env
POSTGRES_PASSWORD=generated_password_here
```

#### Secret Keys

```bash
# Generate unique secret for each contest
openssl rand -hex 32

# Set in .env.contest
SECRET_KEY=generated_hex_string_here
```

#### Firewall Rules

```bash
# Allow only required ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 8888/tcp  # Contest
sudo ufw allow 8889/tcp  # Admin
sudo ufw allow 8890/tcp  # Ranking
sudo ufw enable
```

---

## Scaling

### Horizontal Scaling

#### Scale Workers

```bash
# Deploy worker 1
WORKER_SHARD=1 WORKER_NAME=worker-1 \
  docker compose -f docker-compose.worker.yml -p cms-worker-1 up -d

# Deploy worker 2
WORKER_SHARD=2 WORKER_NAME=worker-2 \
  docker compose -f docker-compose.worker.yml -p cms-worker-2 up -d

# Deploy worker 3
WORKER_SHARD=3 WORKER_NAME=worker-3 \
  docker compose -f docker-compose.worker.yml -p cms-worker-3 up -d
```

#### Scale Contest Servers

For load balancing across multiple contest web servers:

```bash
# Update docker-compose.contest.yml
docker compose -f docker-compose.contest.yml up -d --scale cms-contest-web-server=3
```

### Resource Limits

Edit `.env.worker` to set limits:

```bash
WORKER_CPUS=4        # Number of CPU cores
WORKER_MEMORY=4g     # RAM limit
```

---

## Multiple Contests

Run multiple contests simultaneously:

```bash
# Contest 1 on port 8888
CONTEST_ID=1 CONTEST_PORT_EXTERNAL=8888 SECRET_KEY=$(openssl rand -hex 32) \
  docker compose -f docker-compose.contest.yml -p cms-contest-1 up -d

# Contest 2 on port 8887
CONTEST_ID=2 CONTEST_PORT_EXTERNAL=8887 SECRET_KEY=$(openssl rand -hex 32) \
  docker compose -f docker-compose.contest.yml -p cms-contest-2 up -d

# Contest 3 on port 8886
CONTEST_ID=3 CONTEST_PORT_EXTERNAL=8886 SECRET_KEY=$(openssl rand -hex 32) \
  docker compose -f docker-compose.contest.yml -p cms-contest-3 up -d
```

**Important:**
- Each contest MUST have unique `CONTEST_ID`
- Each contest MUST have unique `SECRET_KEY`
- Each contest MUST have unique `CONTEST_PORT_EXTERNAL`

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Strong database password set
- [ ] Unique secret keys for each contest
- [ ] Firewall configured
- [ ] DNS configured (if using domains)
- [ ] SSL/TLS certificates ready (if using HTTPS)
- [ ] Backup strategy planned
- [ ] Monitoring setup
- [ ] Log rotation configured

### SSL/TLS Setup

For production with HTTPS:

```bash
# Install certbot
sudo apt-get install certbot

# Obtain certificates
sudo certbot certonly --standalone -d contest.example.com
sudo certbot certonly --standalone -d admin.example.com
sudo certbot certonly --standalone -d ranking.example.com

# Configure Nginx proxy
# See ACCESS-CONFIGURATION.md
```

### Backup Strategy

```bash
# Database backup
docker exec cms-database pg_dump -U cmsuser cmsdb > backup-$(date +%Y%m%d-%H%M%S).sql

# Volume backup
docker run --rm -v cms-db-data:/data -v $(pwd):/backup ubuntu tar czf /backup/db-data-$(date +%Y%m%d).tar.gz /data

# Automated daily backups
# Add to crontab
0 2 * * * /path/to/backup-script.sh
```

### Monitoring

```bash
# View service status
./scripts/status.sh

# Monitor logs
docker compose -f docker-compose.core.yml logs -f

# Resource usage
docker stats

# Health checks
docker ps --format "table {{.Names}}\t{{.Status}}"
```

### Maintenance

```bash
# Update CMS
git pull
docker build -t cms:latest .
./scripts/stop-all.sh
./scripts/quick-start.sh

# Clean up old images
docker image prune -a

# Clean up volumes (careful!)
docker volume prune
```

---

## Next Steps

- **[Access Configuration](ACCESS-CONFIGURATION.md)** - Configure domain or public IP access
- **[Remote Workers](WORKER-SETUP.md)** - Set up distributed workers
- **[Portainer Guide](PORTAINER-GUIDE.md)** - Deploy via Portainer UI
- **[Troubleshooting](TROUBLESHOOTING.md)** - Fix common issues
- **[Quick Reference](QUICK-REFERENCE.md)** - Common commands

---

## Support

- 📖 [Full Documentation](README.md)
- 💬 [Telegram Community](https://t.me/contestms)
- 🐛 [Report Issues](https://github.com/cms-dev/cms/issues)
