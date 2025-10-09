# CMS Docker

<!--
CMS Docker - Docker deployment for Contest Management System
Copyright (c) 2025 CCYod
Repository: https://github.com/champyod/cms-docker

This is a Docker containerization project for CMS (Contest Management System).
Original CMS: https://github.com/cms-dev/cms
-->

<div align="center">

![CMS Logo](https://cms-dev.github.io/img/logo.png)

**Production-ready Docker deployment for Contest Management System**

[![Docker](https://img.shields.io/badge/Docker-20.10+-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![Docker Compose](https://img.shields.io/badge/Docker%20Compose-2.0+-2496ED?style=flat&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Portainer](https://img.shields.io/badge/Portainer-Compatible-13BEF9?style=flat&logo=portainer&logoColor=white)](https://www.portainer.io/)
[![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE.txt)

[Features](#-features) •
[Quick Start](#-quick-start) •
[Documentation](#-documentation) •
[Support](#-support)

</div>

---

## 📖 About

**CMS Docker** is a production-ready, microservices-based Docker deployment for the [Contest Management System (CMS)](https://github.com/cms-dev/cms). This project provides an easy-to-deploy, scalable solution for running programming contests with support for multiple deployment methods including **Portainer**.

### What is CMS?

Contest Management System (CMS) is a distributed system for running programming contests like the International Olympiad in Informatics (IOI). It handles everything from contestant registration to automated submission evaluation and real-time ranking.

### About This Project

- **Author**: CCYod
- **Repository**: https://github.com/champyod/cms-docker
- **Upstream**: Fork of [cms-dev/cms](https://github.com/cms-dev/cms)
- **Purpose**: Simplified Docker deployment with Portainer support
- **Status**: Production ready

---

## ✨ Features

- 🐳 **Full Docker Support** - Containerized deployment with Docker Compose
- 📦 **Portainer Ready** - Deploy and manage via Portainer web UI
- 🏗️ **Microservices Architecture** - Separated into 4 independent stacks
- 🌐 **Flexible Access** - Support for both public IP and domain-based access
- 🚀 **Horizontal Scaling** - Scale workers and web servers independently
- 🌍 **Distributed Workers** - Connect evaluation workers from remote servers
- 📊 **Multi-Contest** - Run multiple contests simultaneously
- 🔒 **Production Ready** - Health checks, auto-restart, resource limits
- ⚙️ **Easy Configuration** - Environment variable based setup
- 📚 **Complete Documentation** - Comprehensive guides for all scenarios

---

## 🚀 Quick Start

Choose your preferred setup method:

### Option 1: Automated Script (Fastest)

```bash
# Clone repository
git clone https://github.com/CCYod/cms-docker.git
cd cms-docker

# Run automated setup
./scripts/quick-start.sh
```

The script will guide you through:
1. Choosing access method (Public IP or Domain)
2. Configuring database credentials
3. Setting up ports
4. Deploying all services
5. Creating admin user

**⏱️ Setup time: ~5 minutes**

### Option 2: Portainer Web UI

[Portainer](https://www.portainer.io/) provides a web-based interface for managing Docker containers.

#### Step 1: Install Portainer

If you don't have Portainer installed:

```bash
# Create volume for Portainer data
docker volume create portainer_data

# Deploy Portainer
docker run -d \
  -p 9000:9000 \
  -p 9443:9443 \
  --name portainer \
  --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest
```

Access Portainer at: **http://your-server:9000** or **https://your-server:9443**

#### Step 2: Deploy CMS Stacks via Portainer

1. **Access Portainer Web UI**
   - Open browser: `http://your-server:9000`
   - Create admin account on first login
   - Select your Docker environment

2. **Deploy Core Services Stack**
   - Go to **Stacks** → **+ Add stack**
   - Name: `cms-core`
   - Build method: **Upload** or **Repository**
   - Upload `docker-compose.core.yml` or point to this repository
   - Add environment variables from `.env.core`:
     ```
     POSTGRES_DB=cmsdb
     POSTGRES_USER=cmsuser
     POSTGRES_PASSWORD=your_secure_password
     PUBLIC_IP=your_server_ip
     ```
   - Click **Deploy the stack**
   - Wait for all services to show "running" status

3. **Initialize Database**
   - Go to **Containers**
   - Find `cms-log-service`
   - Click **Console** → **Connect** → `/bin/bash`
   - Run: `cmsInitDB`

4. **Deploy Admin Stack**
   - **Stacks** → **+ Add stack**
   - Name: `cms-admin`
   - Upload `docker-compose.admin.yml`
   - Add environment variables from `.env.admin`:
     ```
     ACCESS_METHOD=public_port
     PUBLIC_IP=your_server_ip
     ADMIN_PORT_EXTERNAL=8889
     RANKING_PORT_EXTERNAL=8890
     ```
   - Deploy

5. **Create Admin User**
   - Find `cms-admin-web-server` in **Containers**
   - **Console** → **Connect** → `/bin/bash`
   - Run: `cmsAddAdmin yourusername`

6. **Deploy Contest Stack**
   - **Stacks** → **+ Add stack**
   - Name: `cms-contest-1`
   - Upload `docker-compose.contest.yml`
   - Add environment variables from `.env.contest`:
     ```
     ACCESS_METHOD=public_port
     PUBLIC_IP=your_server_ip
     CONTEST_ID=1
     CONTEST_PORT_EXTERNAL=8888
     SECRET_KEY=generate_random_key_here
     ```
   - Deploy

7. **Deploy Workers**
   - **Stacks** → **+ Add stack**
   - Name: `cms-worker-0`
   - Upload `docker-compose.worker.yml`
   - Add environment variables from `.env.worker`:
     ```
     WORKER_SHARD=0
     WORKER_NAME=worker-0
     CORE_SERVICES_HOST=cms-log-service
     ```
   - Deploy

**⏱️ Setup time: ~10-15 minutes**

**📖 Detailed Guide**: See [PORTAINER-GUIDE.md](PORTAINER-GUIDE.md) for step-by-step screenshots and advanced configuration.

### Option 3: Manual Docker Compose

For advanced users who prefer command-line control:

```bash
# 1. Clone and configure
git clone https://github.com/CCYod/cms-docker.git
cd cms-docker

# 2. Copy and edit environment files
cp .env.core .env
cp .env.admin .env.admin.local
cp .env.contest .env.contest.local
cp .env.worker .env.worker.local

# Edit files and set passwords/IPs
nano .env
nano .env.admin.local
nano .env.contest.local

# 3. Build image
docker build -t cms:latest .

# 4. Deploy stacks
docker compose -f docker-compose.core.yml --env-file .env up -d
sleep 30  # Wait for database
docker exec cms-log-service cmsInitDB

docker compose -f docker-compose.admin.yml --env-file .env.admin.local up -d
docker compose -f docker-compose.contest.yml --env-file .env.contest.local up -d
docker compose -f docker-compose.worker.yml --env-file .env.worker.local up -d

# 5. Create admin user
docker exec -it cms-admin-web-server cmsAddAdmin myusername
```

**⏱️ Setup time: ~10 minutes**

---

## 🌐 Access Your CMS

After deployment, access CMS based on your configuration:

### Public IP Access (No Domain)

Perfect for VPS without a domain name:

- **Contest Interface**: `http://YOUR_PUBLIC_IP:8888`
- **Admin Interface**: `http://YOUR_PUBLIC_IP:8889`
- **Ranking Interface**: `http://YOUR_PUBLIC_IP:8890`

**Example**: `http://203.0.113.45:8888`

### Domain-Based Access (With DNS)

For production with domain names:

- **Contest Interface**: `http://contest.yourdomain.com`
- **Admin Interface**: `http://admin.yourdomain.com`
- **Ranking Interface**: `http://ranking.yourdomain.com`

📖 **Configuration Guide**: [ACCESS-CONFIGURATION.md](ACCESS-CONFIGURATION.md)

---

## 📚 Documentation

Complete documentation for all scenarios:

| Document | Description | Use Case |
|----------|-------------|----------|
| **[SETUP-GUIDE.md](SETUP-GUIDE.md)** | Complete setup guide | All setup methods in detail |
| **[PORTAINER-GUIDE.md](PORTAINER-GUIDE.md)** | Portainer deployment | Deploy via Portainer UI |
| **[ACCESS-CONFIGURATION.md](ACCESS-CONFIGURATION.md)** | Access configuration | Public IP vs Domain setup |
| **[QUICK-REFERENCE.md](QUICK-REFERENCE.md)** | Quick reference card | Common commands & tasks |
| **[WORKER-SETUP.md](WORKER-SETUP.md)** | Remote worker guide | Distributed workers |
| **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** | Troubleshooting guide | Fix common issues |

### Quick Links

- 🚀 **[Getting Started](SETUP-GUIDE.md#quick-start)** - Start here if you're new
- 📦 **[Portainer Setup](PORTAINER-GUIDE.md)** - Deploy with web UI
- 🌐 **[Access Setup](ACCESS-CONFIGURATION.md)** - Configure access methods
- 🔧 **[Configuration](SETUP-GUIDE.md#configuration)** - Environment variables
- 📈 **[Scaling](SETUP-GUIDE.md#scaling)** - Scale your deployment
- 🐛 **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         CMS CORE STACK                  │
│  Database | LogService | Resources      │
│  Scoring | Evaluation | Proxy | Checker │
└────────────┬────────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
┌───▼──────┐    ┌─────▼──────┐
│  ADMIN   │    │  CONTEST   │
│  STACK   │    │   STACK    │
│          │    │ (Per Event)│
└──────────┘    └────────────┘
    │                 │
    └────────┬────────┘
             │
      ┌──────▼───────┐
      │    WORKER    │
      │    STACK     │
      │  (Scalable)  │
      └──────┬───────┘
             │
    ┌────────┴────────┐
    │                 │
┌───▼────┐      ┌─────▼────┐
│Remote  │      │ Remote   │
│Worker-1│      │ Worker-2 │
└────────┘      └──────────┘
```

### Stack Components

| Stack | Services | Purpose |
|-------|----------|---------|
| **Core** | Database, LogService, ResourceService, ScoringService, EvaluationService, ProxyService, Checker | Essential backend (deploy first) |
| **Admin** | AdminWebServer, RankingWebServer, PrintingService | Management interfaces |
| **Contest** | ContestWebServer, Nginx (optional) | Contestant interface (one per contest) |
| **Worker** | Worker containers | Submission evaluation (scalable) |

---

## 🔧 Configuration

### Access Methods

Choose between two access methods:

#### 1. Public IP + Ports (No Domain Required)

Best for: Testing, VPS without domain

```bash
# Get your public IP
MY_IP=$(curl -4 ifconfig.me)

# Configure environment files
ACCESS_METHOD=public_port
PUBLIC_IP=$MY_IP
```

**Firewall Setup:**
```bash
sudo ufw allow 8888/tcp  # Contest
sudo ufw allow 8889/tcp  # Admin
sudo ufw allow 8890/tcp  # Ranking
```

#### 2. Domain-Based (With DNS)

Best for: Production, HTTPS support

```bash
# Configure DNS first, then:
ACCESS_METHOD=domain
CONTEST_DOMAIN=contest.example.com
ADMIN_DOMAIN=admin.example.com
```

Requires reverse proxy (Nginx/Traefik) - see [ACCESS-CONFIGURATION.md](ACCESS-CONFIGURATION.md)

### Essential Environment Variables

**Core Stack (.env.core):**
```bash
PUBLIC_IP=your.server.ip
POSTGRES_PASSWORD=change_this_password
```

**Contest Stack (.env.contest):**
```bash
CONTEST_ID=1
SECRET_KEY=generate_random_key
ACCESS_METHOD=public_port  # or domain
PUBLIC_IP=your.server.ip
```

**Worker Stack (.env.worker):**
```bash
WORKER_SHARD=0  # Unique per worker
CORE_SERVICES_HOST=your.server.ip  # For remote workers
```

📖 **Full Configuration Guide**: [SETUP-GUIDE.md](SETUP-GUIDE.md#configuration)

---

## 📈 Common Tasks

### View Status

```bash
./scripts/status.sh
```

### View Logs

```bash
# All core services
docker compose -f docker-compose.core.yml logs -f

# Specific service
docker logs -f cms-worker
```

### Stop All Services

```bash
./scripts/stop-all.sh
```

### Backup Database

```bash
docker exec cms-database pg_dump -U cmsuser cmsdb > backup-$(date +%Y%m%d).sql
```

### Scale Workers

```bash
# Deploy additional workers
WORKER_SHARD=1 docker compose -f docker-compose.worker.yml -p cms-worker-1 up -d
WORKER_SHARD=2 docker compose -f docker-compose.worker.yml -p cms-worker-2 up -d
```

### Run Multiple Contests

```bash
# Contest 1 on port 8888
CONTEST_ID=1 CONTEST_PORT_EXTERNAL=8888 \
  docker compose -f docker-compose.contest.yml -p cms-contest-1 up -d

# Contest 2 on port 8887
CONTEST_ID=2 CONTEST_PORT_EXTERNAL=8887 \
  docker compose -f docker-compose.contest.yml -p cms-contest-2 up -d
```

📋 **More Commands**: [QUICK-REFERENCE.md](QUICK-REFERENCE.md)

---

## 🌍 Remote Workers

Connect evaluation workers from remote servers or cloud instances:

### Quick Connect

```bash
# On remote machine
curl -fsSL http://YOUR_SERVER_IP/scripts/worker-connect.sh | sudo bash
```

The script automatically:
- ✅ Installs Docker
- ✅ Downloads configuration
- ✅ Sets up worker environment
- ✅ Creates systemd service
- ✅ Starts the worker

### Firewall Configuration

On your main server, allow remote workers:

```bash
sudo ufw allow from WORKER_IP to any port 5432,22000,25000,28000,28500,28600,29000
```

📖 **Complete Guide**: [WORKER-SETUP.md](WORKER-SETUP.md)

---

## 🐛 Troubleshooting

### Common Issues

**Can't access web interface?**
```bash
# Check if services are running
docker ps

# Check firewall
sudo ufw status

# Check logs
docker logs cms-contest-web-server-1
```

**Database connection errors?**
```bash
# Check database
docker logs cms-database

# Test connection
docker exec cms-database pg_isready -U cmsuser
```

**Workers not connecting?**
```bash
# Check worker logs
docker logs cms-worker

# Check network
docker exec cms-worker ping cms-log-service
```

📖 **Full Troubleshooting Guide**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 📋 Requirements

### Software

- **Docker**: 20.10 or higher
- **Docker Compose**: 2.0 or higher
- **Operating System**: Linux (Ubuntu 20.04+, Debian 11+, or similar)
- **Portainer** (optional): For web-based management

### Hardware

**Minimum (Development):**
- CPU: 4 cores
- RAM: 8 GB
- Storage: 20 GB

**Recommended (Production):**
- CPU: 8+ cores
- RAM: 16+ GB
- Storage: 100+ GB SSD

**Per Worker:**
- CPU: 2-4 cores
- RAM: 2-4 GB
- Storage: 10 GB

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📞 Support

### Get Help

- 📖 **Documentation**: Check the docs folder
- 💬 **Telegram**: [CMS Community](https://t.me/contestms)
- 🐛 **Issues**: [GitHub Issues](https://github.com/cms-dev/cms/issues)
- 📧 **Mailing List**: contestms-support@googlegroups.com

### Resources

- **CMS Official Documentation**: https://cms.readthedocs.io/
- **Docker Documentation**: https://docs.docker.com/
- **Portainer Documentation**: https://docs.portainer.io/

---

## 📄 License

This project inherits the license from the original CMS project (AGPL v3).
See [LICENSE.txt](LICENSE.txt) for details.

---

## 🙏 Acknowledgments

- **[CMS Development Team](https://github.com/cms-dev/cms)** - Original Contest Management System
- **Docker Community** - Containerization technology
- **Portainer Team** - Container management platform
- **Open Source Community** - Continuous support and contributions

---

## ⭐ Star This Repository

If you find this project useful, please consider giving it a star! It helps others discover this deployment solution.

---

<div align="center">

**Made with ❤️ for the competitive programming community**

**[⬆ Back to Top](#cms-docker)**

</div>
