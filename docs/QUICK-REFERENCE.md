# CMS Docker - Quick Reference

<!--
Author: CCYod
Repository: https://github.com/champyod/cms-docker
-->

Quick command reference for CMS Docker operations.

---

## Method 1: Public Port Access (No Domain)

### Quick Setup

```bash
# 1. Get your public IP
MY_IP=$(curl -4 ifconfig.me)
echo "Your public IP: $MY_IP"

# 2. Update .env files
echo "PUBLIC_IP=$MY_IP" >> .env.core
sed -i "s/ACCESS_METHOD=.*/ACCESS_METHOD=public_port/" .env.admin
sed -i "s/PUBLIC_IP=.*/PUBLIC_IP=$MY_IP/" .env.admin
sed -i "s/ACCESS_METHOD=.*/ACCESS_METHOD=public_port/" .env.contest
sed -i "s/PUBLIC_IP=.*/PUBLIC_IP=$MY_IP/" .env.contest

# 3. Configure firewall
sudo ufw allow 8888/tcp  # Contest
sudo ufw allow 8889/tcp  # Admin
sudo ufw allow 8890/tcp  # Ranking
sudo ufw reload

# 4. Deploy
./scripts/quick-start.sh

# 5. Access URLs
echo "Contest: http://$MY_IP:8888"
echo "Admin:   http://$MY_IP:8889"
echo "Ranking: http://$MY_IP:8890"
```

### Cloud Provider Firewall Rules

**AWS Security Group:**
```
Type        Protocol    Port    Source
Custom TCP  TCP         8888    0.0.0.0/0
Custom TCP  TCP         8889    0.0.0.0/0
Custom TCP  TCP         8890    0.0.0.0/0
```

**GCP Firewall:**
```bash
gcloud compute firewall-rules create cms-web-access \
  --allow tcp:8888,tcp:8889,tcp:8890 \
  --source-ranges 0.0.0.0/0
```

**Azure NSG:**
```
Priority    Name        Port    Protocol    Source      Destination
100         CMS-Web     8888    TCP         Any         Any
101         CMS-Admin   8889    TCP         Any         Any
102         CMS-Rank    8890    TCP         Any         Any
```

---

## Method 2: Domain-Based Access (With DNS)

### Quick Setup

```bash
# 1. Configure DNS (in your DNS provider)
# Add A records:
# contest.example.com → YOUR_SERVER_IP
# admin.example.com   → YOUR_SERVER_IP
# ranking.example.com → YOUR_SERVER_IP

# 2. Update .env files
sed -i "s/ACCESS_METHOD=.*/ACCESS_METHOD=domain/" .env.admin
sed -i "s/ADMIN_DOMAIN=.*/ADMIN_DOMAIN=admin.example.com/" .env.admin
sed -i "s/RANKING_DOMAIN=.*/RANKING_DOMAIN=ranking.example.com/" .env.admin
sed -i "s/ACCESS_METHOD=.*/ACCESS_METHOD=domain/" .env.contest
sed -i "s/CONTEST_DOMAIN=.*/CONTEST_DOMAIN=contest.example.com/" .env.contest

# 3. Install Nginx
sudo apt update && sudo apt install -y nginx

# 4. Configure Nginx (see ACCESS-CONFIGURATION.md)

# 5. Configure firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload

# 6. Deploy
./scripts/quick-start.sh

# 7. Enable HTTPS
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d contest.example.com -d admin.example.com -d ranking.example.com
```

---

## Remote Workers Setup

### Quick Connect (Automated)

```bash
# On remote machine
curl -fsSL http://YOUR_SERVER_IP:8889/scripts/worker-connect.sh | sudo bash
```

### Manual Setup

```bash
# 1. On remote machine
sudo apt update && sudo apt install -y docker.io docker-compose

# 2. Create worker directory
sudo mkdir -p /opt/cms-worker

# 3. Copy config (replace YOUR_SERVER_IP)
cat > /opt/cms-worker/.env << EOF
CORE_SERVICES_HOST=YOUR_SERVER_IP
WORKER_SHARD=10
WORKER_NAME=remote-worker-10
CMS_CONFIG=/usr/local/etc/cms.conf
EOF

# 4. Download compose file and config
# (See ACCESS-CONFIGURATION.md for details)

# 5. Start worker
cd /opt/cms-worker
docker-compose up -d
```

### Firewall for Remote Workers

**On main server, allow these ports from worker IPs:**

```bash
# For specific worker IP
sudo ufw allow from WORKER_IP to any port 5432,22000,25000,28000,28500,28600,29000

# Or allow from all (less secure)
sudo ufw allow 5432/tcp   # Database
sudo ufw allow 22000/tcp  # Checker
sudo ufw allow 25000/tcp  # Evaluation
sudo ufw allow 28000/tcp  # Resource
sudo ufw allow 28500/tcp  # Scoring
sudo ufw allow 28600/tcp  # Proxy
sudo ufw allow 29000/tcp  # Log
```

---

## Multiple Contests

```bash
# Contest 1 on port 8888
CONTEST_ID=1 CONTEST_PORT_EXTERNAL=8888 \
  docker compose -f docker-compose.contest.yml -p cms-contest-1 up -d

# Contest 2 on port 8887
CONTEST_ID=2 CONTEST_PORT_EXTERNAL=8887 \
  docker compose -f docker-compose.contest.yml -p cms-contest-2 up -d

# Contest 3 on port 8886
CONTEST_ID=3 CONTEST_PORT_EXTERNAL=8886 \
  docker compose -f docker-compose.contest.yml -p cms-contest-3 up -d

# Access:
# Contest 1: http://YOUR_IP:8888
# Contest 2: http://YOUR_IP:8887
# Contest 3: http://YOUR_IP:8886

# Don't forget to open firewall ports!
sudo ufw allow 8887/tcp
sudo ufw allow 8886/tcp
```

---

## Essential Commands

### Management

```bash
# View status
./scripts/status.sh

# View logs
docker compose -f docker-compose.core.yml logs -f

# Stop all
./scripts/stop-all.sh

# Restart service
docker restart cms-worker
```

### Database

```bash
# Initialize database
docker exec cms-log-service cmsInitDB

# Backup database
docker exec cms-database pg_dump -U cmsuser cmsdb > backup.sql

# Restore database
cat backup.sql | docker exec -i cms-database psql -U cmsuser cmsdb
```

### Users

```bash
# Create admin user
docker exec -it cms-admin-web-server cmsAddAdmin username

# Import contest
docker exec -it cms-admin-web-server cmsImportContest /path/to/contest

# Add user
docker exec -it cms-admin-web-server cmsAddUser username
```

---

## Troubleshooting Quick Fixes

### Can't Access Web Interface

```bash
# Check if running
docker ps | grep cms

# Check ports
sudo netstat -tulpn | grep :8888

# Check firewall
sudo ufw status

# Check from server itself
curl http://localhost:8888
```

### Database Connection Errors

```bash
# Check database
docker logs cms-database

# Test connection
docker exec cms-database pg_isready -U cmsuser

# Restart database
docker restart cms-database
```

### Workers Not Connecting

```bash
# Check worker logs
docker logs cms-worker

# Check network
docker exec cms-worker ping cms-log-service

# Restart worker
docker restart cms-worker
```

---

## Environment Variables Reference

### Core (.env.core)
```bash
PUBLIC_IP=203.0.113.45      # Your server public IP
POSTGRES_PASSWORD=***       # Change this!
```

### Admin (.env.admin)
```bash
ACCESS_METHOD=public_port   # or "domain"
PUBLIC_IP=203.0.113.45      # Your server public IP
ADMIN_PORT_EXTERNAL=8889
RANKING_PORT_EXTERNAL=8890
```

### Contest (.env.contest)
```bash
ACCESS_METHOD=public_port   # or "domain"
PUBLIC_IP=203.0.113.45      # Your server public IP
CONTEST_ID=1                # Unique per contest
CONTEST_PORT_EXTERNAL=8888
SECRET_KEY=***              # Generate new!
```

### Worker (.env.worker)
```bash
CORE_SERVICES_HOST=203.0.113.45  # Main server IP
WORKER_SHARD=0                    # Unique per worker
WORKER_NAME=worker-0
```

---

## Port Reference

### Web Access Ports
- **8888** - Contest Web Interface
- **8889** - Admin Web Interface
- **8890** - Ranking Interface

### Internal Service Ports
- **5432** - PostgreSQL Database
- **22000** - Checker Service
- **25000** - Evaluation Service
- **28000** - Resource Service
- **28500** - Scoring Service
- **28600** - Proxy Service
- **29000** - Log Service

---

## Getting Public IP

```bash
# Method 1
curl -4 ifconfig.me

# Method 2
curl -4 icanhazip.com

# Method 3
dig +short myip.opendns.com @resolver1.opendns.com

# Method 4 (from local interface)
ip addr show | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | cut -d/ -f1
```

---

## Security Checklist

- [ ] Change `POSTGRES_PASSWORD` in `.env.core`
- [ ] Generate unique `SECRET_KEY` for each contest
- [ ] Configure firewall (ufw/firewalld)
- [ ] Enable HTTPS for production (Let's Encrypt)
- [ ] Use strong admin passwords
- [ ] Regular database backups
- [ ] Update Docker images regularly
- [ ] Restrict database access to localhost
- [ ] Use private network for workers if possible

---

## Quick Links

- **Full Guide**: [DOCKER-DEPLOYMENT.md](DOCKER-DEPLOYMENT.md)
- **Access Setup**: [ACCESS-CONFIGURATION.md](ACCESS-CONFIGURATION.md)
- **Portainer**: [PORTAINER-GUIDE.md](PORTAINER-GUIDE.md)
- **Quick Start**: [QUICKSTART.md](QUICKSTART.md)
- **CMS Docs**: https://cms.readthedocs.io/

---

**Need Help?**
- Telegram: https://t.me/contestms
- GitHub: https://github.com/cms-dev/cms/issues

---

*Keep this card handy for quick reference! 📋*
