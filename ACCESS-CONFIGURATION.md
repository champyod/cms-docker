# CMS Access Configuration Guide

<!--
Author: CCYod
Repository: https://github.com/champyod/cms-docker
-->

## Overview

CMS can be accessed in two ways:
1. **Public Port Access** (Recommended for VPS without domain)
2. **Domain-Based Access** (Recommended for production with DNS)

This guide helps you choose and configure the right access method.

---

## Method 1: Public Port Access (No Domain Required)

**Best for:**
- VPS/Cloud server without domain name
- Quick setup and testing
- Direct IP-based access

### Configuration Steps

#### Step 1: Get Your VPS Public IP

Find your VPS public IP address:

```bash
# Method 1: Using curl
curl -4 ifconfig.me

# Method 2: Using ip command
ip addr show | grep "inet " | grep -v 127.0.0.1

# Method 3: Using hostname
hostname -I | awk '{print $1}'
```

Example output: `203.0.113.45`

#### Step 2: Update Environment Files

**Edit `.env.core`:**
```bash
PUBLIC_IP=203.0.113.45  # Replace with your actual IP
```

**Edit `.env.admin`:**
```bash
ACCESS_METHOD=public_port
PUBLIC_IP=203.0.113.45  # Replace with your actual IP
ADMIN_PORT_EXTERNAL=8889
RANKING_PORT_EXTERNAL=8890
```

**Edit `.env.contest`:**
```bash
ACCESS_METHOD=public_port
PUBLIC_IP=203.0.113.45  # Replace with your actual IP
CONTEST_ID=1
CONTEST_PORT_EXTERNAL=8888
```

#### Step 3: Configure Firewall

Allow access to required ports:

```bash
# Ubuntu/Debian (UFW)
sudo ufw allow 8888/tcp  # Contest
sudo ufw allow 8889/tcp  # Admin
sudo ufw allow 8890/tcp  # Ranking
sudo ufw reload

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=8888/tcp
sudo firewall-cmd --permanent --add-port=8889/tcp
sudo firewall-cmd --permanent --add-port=8890/tcp
sudo firewall-cmd --reload

# Cloud Provider Firewall (AWS, GCP, Azure, etc.)
# Add inbound rules for ports 8888, 8889, 8890 in your cloud console
```

#### Step 4: Deploy Services

```bash
# Deploy all stacks
./scripts/quick-start.sh

# Or manually
docker compose -f docker-compose.core.yml --env-file .env.core up -d
docker compose -f docker-compose.admin.yml --env-file .env.admin up -d
docker compose -f docker-compose.contest.yml --env-file .env.contest up -d
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d
```

#### Step 5: Access CMS

Access your CMS using your public IP:

- **Contest Interface**: `http://203.0.113.45:8888`
- **Admin Interface**: `http://203.0.113.45:8889`
- **Ranking Interface**: `http://203.0.113.45:8890`

Replace `203.0.113.45` with your actual public IP.

### Port Mapping Reference

| Service | Internal Port | External Port | Access URL |
|---------|---------------|---------------|------------|
| Contest | 8888 | 8888 | `http://YOUR_IP:8888` |
| Admin | 8889 | 8889 | `http://YOUR_IP:8889` |
| Ranking | 8890 | 8890 | `http://YOUR_IP:8890` |

### Multiple Contests with Public Ports

For multiple contests, use different external ports:

**Contest 1:**
```bash
CONTEST_ID=1
CONTEST_PORT_EXTERNAL=8888
# Access: http://YOUR_IP:8888
```

**Contest 2:**
```bash
CONTEST_ID=2
CONTEST_PORT_EXTERNAL=8887
# Access: http://YOUR_IP:8887
```

**Contest 3:**
```bash
CONTEST_ID=3
CONTEST_PORT_EXTERNAL=8886
# Access: http://YOUR_IP:8886
```

Deploy each with different project names:
```bash
CONTEST_ID=1 CONTEST_PORT_EXTERNAL=8888 docker compose -f docker-compose.contest.yml -p cms-contest-1 up -d
CONTEST_ID=2 CONTEST_PORT_EXTERNAL=8887 docker compose -f docker-compose.contest.yml -p cms-contest-2 up -d
CONTEST_ID=3 CONTEST_PORT_EXTERNAL=8886 docker compose -f docker-compose.contest.yml -p cms-contest-3 up -d
```

---

## Method 2: Domain-Based Access (With DNS)

**Best for:**
- Production deployments
- HTTPS/SSL support
- Professional appearance
- Multiple contests on same IP

### Prerequisites

- Domain name registered (e.g., `example.com`)
- DNS configured to point to your server IP
- Reverse proxy (Nginx or Traefik)

### DNS Configuration

Add DNS A records for your domain:

```
Type    Name        Value           TTL
A       contest     203.0.113.45    300
A       admin       203.0.113.45    300
A       ranking     203.0.113.45    300
```

Or use subdomains:
```
contest.example.com  → 203.0.113.45
admin.example.com    → 203.0.113.45
ranking.example.com  → 203.0.113.45
```

### Configuration Steps

#### Step 1: Update Environment Files

**Edit `.env.admin`:**
```bash
ACCESS_METHOD=domain
PUBLIC_IP=203.0.113.45  # Your server IP
ADMIN_DOMAIN=admin.example.com
RANKING_DOMAIN=ranking.example.com
ADMIN_PORT_EXTERNAL=8889  # Internal port for reverse proxy
RANKING_PORT_EXTERNAL=8890
```

**Edit `.env.contest`:**
```bash
ACCESS_METHOD=domain
PUBLIC_IP=203.0.113.45
CONTEST_ID=1
CONTEST_DOMAIN=contest.example.com
CONTEST_PORT_EXTERNAL=8888  # Internal port for reverse proxy
```

#### Step 2: Setup Reverse Proxy

**Option A: Using Nginx**

Create `/etc/nginx/sites-available/cms`:

```nginx
# Contest
server {
    listen 80;
    server_name contest.example.com;
    
    location / {
        proxy_pass http://localhost:8888;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Admin
server {
    listen 80;
    server_name admin.example.com;
    
    location / {
        proxy_pass http://localhost:8889;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Ranking
server {
    listen 80;
    server_name ranking.example.com;
    
    location / {
        proxy_pass http://localhost:8890;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/cms /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Option B: Using Traefik**

The Docker Compose files already include Traefik labels. Just deploy Traefik:

```yaml
# traefik-compose.yml
version: '3.8'
services:
  traefik:
    image: traefik:v2.10
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
    ports:
      - "80:80"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - cms-network

networks:
  cms-network:
    external: true
```

Deploy: `docker compose -f traefik-compose.yml up -d`

#### Step 3: Configure Firewall

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

#### Step 4: Deploy Services

```bash
./scripts/quick-start.sh
```

#### Step 5: Access CMS

- **Contest**: `http://contest.example.com`
- **Admin**: `http://admin.example.com`
- **Ranking**: `http://ranking.example.com`

### Enable HTTPS with Let's Encrypt

#### Using Certbot (Nginx)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificates
sudo certbot --nginx -d contest.example.com -d admin.example.com -d ranking.example.com

# Auto-renewal is configured automatically
```

#### Using Traefik with Let's Encrypt

Update `traefik-compose.yml`:

```yaml
services:
  traefik:
    image: traefik:v2.10
    command:
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./acme.json:/acme.json
    networks:
      - cms-network
```

Create acme.json:
```bash
touch acme.json
chmod 600 acme.json
```

Update `.env.contest`:
```bash
ENABLE_TLS=true
TLS_CERTRESOLVER=letsencrypt
```

Redeploy services.

---

## Remote Worker Configuration

### For Public Port Access

When using public IP, remote workers need to connect to your server's public IP.

**On Remote Worker Machine:**

Edit worker configuration or use the connect script:

```bash
# Download and run worker connect script
curl -fsSL http://203.0.113.45:8889/scripts/worker-connect.sh -o worker-connect.sh
chmod +x worker-connect.sh
sudo ./worker-connect.sh
```

When prompted, enter your **public IP**: `203.0.113.45`

**Or manually configure:**

```bash
# .env.worker on remote machine
CORE_SERVICES_HOST=203.0.113.45
WORKER_SHARD=10  # Use unique numbers for remote workers
WORKER_NAME=remote-worker-10
```

### Required Ports for Remote Workers

Remote workers need access to these ports on your main server:

| Service | Port | Protocol |
|---------|------|----------|
| Database | 5432 | TCP |
| LogService | 29000 | TCP |
| ResourceService | 28000 | TCP |
| ScoringService | 28500 | TCP |
| EvaluationService | 25000 | TCP |
| ProxyService | 28600 | TCP |
| Checker | 22000 | TCP |

**Configure firewall on main server:**

```bash
# Allow from specific worker IP
sudo ufw allow from WORKER_IP to any port 5432,22000,25000,28000,28500,28600,29000

# Or allow from all (less secure)
sudo ufw allow 5432/tcp
sudo ufw allow 22000/tcp
sudo ufw allow 25000/tcp
sudo ufw allow 28000/tcp
sudo ufw allow 28500/tcp
sudo ufw allow 28600/tcp
sudo ufw allow 29000/tcp
```

---

## Cloud Provider Specific Instructions

### AWS EC2

1. **Get Public IP**: Check EC2 instance details
2. **Security Groups**: Add inbound rules for ports 8888, 8889, 8890
3. **For workers**: Add rules for ports 5432, 22000, 25000, 28000, 28500, 28600, 29000

### Google Cloud Platform (GCP)

1. **Get Public IP**: Check VM instance external IP
2. **Firewall Rules**: Create rules for required ports
   ```bash
   gcloud compute firewall-rules create cms-web \
     --allow tcp:8888,tcp:8889,tcp:8890
   ```

### Azure

1. **Get Public IP**: Check VM public IP address
2. **Network Security Group**: Add inbound rules for required ports

### DigitalOcean

1. **Get Public IP**: Droplet's public IPv4
2. **Cloud Firewall**: Create firewall with required inbound rules

---

## Troubleshooting

### Cannot Access from Public IP

**Check 1: Verify services are running**
```bash
docker ps
./scripts/status.sh
```

**Check 2: Verify ports are listening**
```bash
sudo netstat -tulpn | grep :8888
sudo netstat -tulpn | grep :8889
sudo netstat -tulpn | grep :8890
```

**Check 3: Check firewall**
```bash
sudo ufw status
sudo iptables -L -n | grep 888
```

**Check 4: Check cloud provider firewall**
- Verify security groups (AWS)
- Check firewall rules (GCP, Azure, etc.)

**Check 5: Test from server itself**
```bash
curl http://localhost:8888
curl http://127.0.0.1:8889
```

**Check 6: Test from another machine**
```bash
telnet YOUR_PUBLIC_IP 8888
curl http://YOUR_PUBLIC_IP:8888
```

### Connection Refused

- Ensure `CONTEST_LISTEN_ADDRESS=0.0.0.0` (not 127.0.0.1)
- Check Docker port mappings: `docker port cms-contest-web-server-1`
- Restart services: `docker compose restart`

### Domain Not Resolving

```bash
# Check DNS propagation
nslookup contest.example.com
dig contest.example.com

# Wait for DNS propagation (can take up to 48 hours)
```

### HTTPS Not Working

- Check certificates: `sudo certbot certificates`
- Check Nginx config: `sudo nginx -t`
- Check Traefik logs: `docker logs traefik`

---

## Quick Reference

### Public Port Access Summary

```bash
# 1. Get public IP
MY_IP=$(curl -4 ifconfig.me)

# 2. Update .env files
echo "PUBLIC_IP=$MY_IP" >> .env.core
echo "ACCESS_METHOD=public_port" >> .env.admin
echo "PUBLIC_IP=$MY_IP" >> .env.admin
echo "ACCESS_METHOD=public_port" >> .env.contest
echo "PUBLIC_IP=$MY_IP" >> .env.contest

# 3. Configure firewall
sudo ufw allow 8888/tcp
sudo ufw allow 8889/tcp
sudo ufw allow 8890/tcp

# 4. Deploy
./scripts/quick-start.sh

# 5. Access
echo "Contest: http://$MY_IP:8888"
echo "Admin: http://$MY_IP:8889"
echo "Ranking: http://$MY_IP:8890"
```

### Domain-Based Access Summary

```bash
# 1. Configure DNS (in your DNS provider)
# Add A records pointing to your server IP

# 2. Update .env files
echo "ACCESS_METHOD=domain" >> .env.admin
echo "ADMIN_DOMAIN=admin.example.com" >> .env.admin
echo "ACCESS_METHOD=domain" >> .env.contest
echo "CONTEST_DOMAIN=contest.example.com" >> .env.contest

# 3. Setup reverse proxy (Nginx or Traefik)

# 4. Configure firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 5. Deploy
./scripts/quick-start.sh

# 6. Enable HTTPS
sudo certbot --nginx -d contest.example.com -d admin.example.com
```

---

## Recommendations

### Development/Testing
- ✅ Use **Public Port Access**
- ✅ Use HTTP (no SSL)
- ✅ Single server deployment

### Production
- ✅ Use **Domain-Based Access**
- ✅ Enable HTTPS with Let's Encrypt
- ✅ Use reverse proxy (Nginx/Traefik)
- ✅ Configure proper firewall rules
- ✅ Use strong passwords and secret keys
- ✅ Regular backups

---

**Need help?** See [DOCKER-DEPLOYMENT.md](DOCKER-DEPLOYMENT.md) or [QUICKSTART.md](QUICKSTART.md)
