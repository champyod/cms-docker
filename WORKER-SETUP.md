# Remote Worker Setup Guide

<!--
Author: CCYod
Repository: https://github.com/champyod/cms-docker
-->

This guide covers setting up remote evaluation workers that connect to your main CMS server.

## Table of Contents

- [Overview](#overview)
- [Quick Setup](#quick-setup)
- [Manual Setup](#manual-setup)
- [Network Configuration](#network-configuration)
- [Multiple Remote Workers](#multiple-remote-workers)
- [Cloud Provider Setup](#cloud-provider-setup)
- [Troubleshooting](#troubleshooting)

---

## Overview

### What are Remote Workers?

Remote workers are evaluation containers that run on separate machines from your main CMS server. They connect to the core services to receive submissions for evaluation.

### Benefits

- **Horizontal Scaling**: Add more evaluation capacity on demand
- **Geographic Distribution**: Place workers closer to contestants
- **Resource Isolation**: Isolate evaluation from web services
- **Cost Optimization**: Use cheaper compute instances for workers
- **Fault Tolerance**: Worker failures don't affect main server

### Architecture

```
┌─────────────────┐
│   Main Server   │
│                 │
│  Core Services  │
│  Admin/Contest  │
└────────┬────────┘
         │
    Internet
         │
    ┌────┴────┬────────┬────────┐
    │         │        │        │
┌───▼───┐ ┌──▼───┐ ┌──▼───┐ ┌──▼───┐
│Worker1│ │Worker2│ │Worker3│ │Worker4│
│ AWS   │ │  GCP  │ │Azure │ │ DO   │
└───────┘ └──────┘ └──────┘ └──────┘
```

---

## Quick Setup

### One-Command Installation

On your remote worker machine:

```bash
curl -fsSL http://YOUR_MAIN_SERVER_IP/scripts/worker-connect.sh | sudo bash
```

**What it does:**
1. ✅ Checks for Docker, installs if missing
2. ✅ Prompts for main server IP
3. ✅ Prompts for worker shard number
4. ✅ Downloads configuration
5. ✅ Creates environment file
6. ✅ Pulls Docker image
7. ✅ Creates systemd service
8. ✅ Starts worker
9. ✅ Shows status

**Interactive Prompts:**

```
Enter the IP address of your main CMS server: 203.0.113.45
Enter worker shard number (unique, e.g., 1, 2, 3): 1
Enter worker name [worker-1]: worker-aws-1
```

**Setup time: ~5 minutes**

### Serving the Script

On your main server, make the script accessible:

```bash
# Option 1: Using Python HTTP server
cd cms-docker/scripts
python3 -m http.server 8000

# Option 2: Using Nginx
sudo cp worker-connect.sh /var/www/html/scripts/
```

Then workers can access:
```bash
curl -fsSL http://YOUR_SERVER_IP:8000/worker-connect.sh | sudo bash
```

---

## Manual Setup

For users who want more control:

### Step 1: Prepare Remote Machine

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Verify
docker --version
```

### Step 2: Create Worker Directory

```bash
mkdir -p ~/cms-worker
cd ~/cms-worker
```

### Step 3: Create Environment File

Create `.env.worker`:

```bash
# Worker Configuration
WORKER_SHARD=1  # MUST be unique per worker
WORKER_NAME=worker-remote-1

# Main Server Connection
CORE_SERVICES_HOST=203.0.113.45  # Your main server public IP

# Resource Limits
WORKER_CPUS=4
WORKER_MEMORY=4g

# Service Ports (must match main server)
LOG_SERVICE_PORT=22000
RESOURCE_SERVICE_PORT=25000
SCORING_SERVICE_PORT=28000
CHECKER_PORT=28500
EVALUATION_SERVICE_PORT=28600
PROXY_SERVICE_PORT=29000
```

### Step 4: Create docker-compose.yml

```yaml
version: '3.8'

services:
  cms-worker:
    image: cms:latest
    container_name: cms-worker-${WORKER_SHARD}
    hostname: worker-${WORKER_SHARD}
    restart: unless-stopped
    
    privileged: true
    security_opt:
      - seccomp:unconfined
      - apparmor:unconfined
    
    environment:
      - CMS_CONFIG=/usr/local/etc/cms.conf
      - WORKER_SHARD=${WORKER_SHARD}
      - WORKER_NAME=${WORKER_NAME:-worker-${WORKER_SHARD}}
      - CORE_SERVICES_HOST=${CORE_SERVICES_HOST}
    
    volumes:
      - ./config/cms.conf:/usr/local/etc/cms.conf:ro
      - cms-worker-cache:/var/local/cache/cms
      - cms-worker-log:/var/local/log/cms
    
    deploy:
      resources:
        limits:
          cpus: '${WORKER_CPUS:-2}'
          memory: ${WORKER_MEMORY:-2g}
    
    command: cmsWorker ${WORKER_SHARD}

volumes:
  cms-worker-cache:
  cms-worker-log:
```

### Step 5: Download Configuration

Get `cms.conf` from main server:

```bash
mkdir -p config

# Method 1: SCP
scp user@YOUR_SERVER_IP:/path/to/cms-docker/config/cms.conf config/

# Method 2: Manual copy/paste
nano config/cms.conf
# Paste content from main server
```

Edit `config/cms.conf` to use main server IP:

```json
{
    "core_services": {
        "LogService":        [["YOUR_SERVER_IP", 22000]],
        "ResourceService":   [["YOUR_SERVER_IP", 25000]],
        "ScoringService":    [["YOUR_SERVER_IP", 28000]],
        "Checker":           [["YOUR_SERVER_IP", 28500]],
        "EvaluationService": [["YOUR_SERVER_IP", 28600]],
        "Worker":            [],
        "ProxyService":      [["YOUR_SERVER_IP", 29000]]
    }
}
```

### Step 6: Pull Docker Image

```bash
# Pull from Docker Hub (if you pushed it)
docker pull your-username/cms:latest
docker tag your-username/cms:latest cms:latest

# OR build locally
git clone https://github.com/CCYod/cms-docker.git
cd cms-docker
docker build -t cms:latest .
```

### Step 7: Start Worker

```bash
docker compose up -d
```

### Step 8: Verify Connection

```bash
# Check logs
docker logs -f cms-worker-1

# Should see:
# "Worker 1 connected to LogService"
# "Worker 1 connected to ResourceService"
# etc.
```

---

## Network Configuration

### Main Server Firewall

Allow worker connections:

```bash
# UFW (Ubuntu/Debian)
sudo ufw allow from WORKER_IP to any port 22000
sudo ufw allow from WORKER_IP to any port 25000
sudo ufw allow from WORKER_IP to any port 28000
sudo ufw allow from WORKER_IP to any port 28500
sudo ufw allow from WORKER_IP to any port 28600
sudo ufw allow from WORKER_IP to any port 29000

# Or allow all from worker IP
sudo ufw allow from WORKER_IP

# firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --zone=public --add-rich-rule='
  rule family="ipv4"
  source address="WORKER_IP"
  port port="22000-29000" protocol="tcp" accept'
sudo firewall-cmd --reload
```

### Cloud Provider Security Groups

#### AWS

```bash
# Add inbound rules to main server security group
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxxxxxx \
  --protocol tcp \
  --port 22000-29000 \
  --source-group sg-worker-group
```

Or via AWS Console:
1. EC2 → Security Groups
2. Select main server security group
3. Inbound Rules → Edit
4. Add Custom TCP Rule: Ports 22000-29000, Source: Worker security group

#### Google Cloud Platform

```bash
# Create firewall rule
gcloud compute firewall-rules create cms-workers \
  --allow tcp:22000-29000 \
  --source-ranges WORKER_IP/32 \
  --target-tags cms-main-server
```

#### Azure

```bash
# Add network security group rule
az network nsg rule create \
  --resource-group YourResourceGroup \
  --nsg-name YourNSG \
  --name allow-cms-workers \
  --priority 100 \
  --source-address-prefixes WORKER_IP/32 \
  --destination-port-ranges 22000-29000 \
  --access Allow \
  --protocol Tcp
```

#### DigitalOcean

Via Web Console:
1. Networking → Firewalls
2. Create Firewall
3. Inbound Rules: Custom TCP 22000-29000 from Worker Droplet
4. Apply to main server Droplet

---

## Multiple Remote Workers

### Automated Deployment

Script to deploy multiple workers:

```bash
#!/bin/bash
# deploy-workers.sh

MAIN_SERVER_IP="203.0.113.45"
WORKERS=("worker1-ip" "worker2-ip" "worker3-ip")

for i in "${!WORKERS[@]}"; do
  WORKER_IP="${WORKERS[$i]}"
  SHARD=$((i + 1))
  
  echo "Deploying worker $SHARD on $WORKER_IP..."
  
  ssh root@$WORKER_IP "curl -fsSL http://$MAIN_SERVER_IP/scripts/worker-connect.sh | \
    WORKER_SHARD=$SHARD \
    MAIN_SERVER_IP=$MAIN_SERVER_IP \
    bash"
done
```

### Worker Management

```bash
# Check all workers
for ip in worker1-ip worker2-ip worker3-ip; do
  echo "Worker at $ip:"
  ssh root@$ip "docker ps --filter 'name=cms-worker'"
done

# View all worker logs
for ip in worker1-ip worker2-ip worker3-ip; do
  echo "=== Worker at $ip ==="
  ssh root@$ip "docker logs --tail 50 cms-worker-*"
done

# Restart all workers
for ip in worker1-ip worker2-ip worker3-ip; do
  ssh root@$ip "docker restart cms-worker-*"
done
```

---

## Cloud Provider Setup

### AWS EC2

```bash
# Launch worker instance
aws ec2 run-instances \
  --image-id ami-xxxxxxxxx \
  --instance-type c5.xlarge \
  --key-name your-key \
  --security-group-ids sg-workers \
  --user-data '#!/bin/bash
curl -fsSL http://YOUR_SERVER_IP/scripts/worker-connect.sh | bash'

# Or use EC2 launch template
```

### Google Compute Engine

```bash
# Create worker instance
gcloud compute instances create cms-worker-1 \
  --machine-type n1-standard-4 \
  --image-family ubuntu-2004-lts \
  --image-project ubuntu-os-cloud \
  --metadata startup-script='#!/bin/bash
curl -fsSL http://YOUR_SERVER_IP/scripts/worker-connect.sh | bash'
```

### Azure VM

```bash
# Create worker VM
az vm create \
  --resource-group YourResourceGroup \
  --name cms-worker-1 \
  --image UbuntuLTS \
  --size Standard_D4s_v3 \
  --custom-data worker-init.sh
```

### DigitalOcean Droplet

Via Web Console:
1. Create Droplet
2. Choose: Ubuntu 22.04, 4GB/2vCPU
3. Add User Data:
   ```bash
   #!/bin/bash
   curl -fsSL http://YOUR_SERVER_IP/scripts/worker-connect.sh | bash
   ```

---

## Systemd Service

For production, create systemd service:

```bash
sudo nano /etc/systemd/system/cms-worker.service
```

```ini
[Unit]
Description=CMS Worker Container
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/root/cms-worker
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable cms-worker
sudo systemctl start cms-worker
sudo systemctl status cms-worker
```

---

## Troubleshooting

### Worker Can't Connect

**Check network connectivity:**
```bash
# From worker machine
ping YOUR_SERVER_IP
telnet YOUR_SERVER_IP 22000
telnet YOUR_SERVER_IP 25000
```

**Check firewall:**
```bash
# On main server
sudo ufw status
sudo iptables -L -n | grep 22000
```

**Check service status:**
```bash
# On main server
docker ps | grep cms
docker logs cms-log-service
```

### Worker Crashes

**Check logs:**
```bash
docker logs cms-worker-1
```

**Common issues:**
- Insufficient memory: Increase `WORKER_MEMORY`
- Insufficient CPU: Increase `WORKER_CPUS`
- Duplicate shard: Ensure unique `WORKER_SHARD`

### Performance Issues

**Monitor resources:**
```bash
docker stats cms-worker-1
```

**Adjust limits:**
```bash
# In .env.worker
WORKER_CPUS=8
WORKER_MEMORY=8g
```

### Connection Timeout

**Increase timeout in cms.conf:**
```json
{
    "timeout": 30
}
```

---

## Monitoring

### Health Check Script

```bash
#!/bin/bash
# health-check.sh

WORKER_NAME="cms-worker-1"

if docker ps | grep -q $WORKER_NAME; then
  echo "✅ Worker running"
  
  # Check logs for errors
  if docker logs --tail 100 $WORKER_NAME 2>&1 | grep -i error; then
    echo "⚠️  Errors found in logs"
  else
    echo "✅ No errors in recent logs"
  fi
else
  echo "❌ Worker not running"
  echo "Attempting restart..."
  docker compose up -d
fi
```

Add to crontab:
```bash
*/5 * * * * /root/cms-worker/health-check.sh
```

---

## Best Practices

1. **Unique Shards**: Always use unique WORKER_SHARD numbers
2. **Resource Limits**: Set appropriate CPU/memory limits
3. **Monitoring**: Set up health checks and alerts
4. **Backups**: Workers are stateless, but backup configs
5. **Security**: Use VPN or private networks when possible
6. **Updates**: Keep workers in sync with main server version
7. **Scaling**: Add workers before contests, remove after

---

## Next Steps

- **[Setup Guide](SETUP-GUIDE.md)** - Main setup instructions
- **[Troubleshooting](TROUBLESHOOTING.md)** - Fix common issues
- **[Quick Reference](QUICK-REFERENCE.md)** - Common commands

---

## Support

- 📖 [Full Documentation](README.md)
- 💬 [Telegram Community](https://t.me/contestms)
- 🐛 [Report Issues](https://github.com/cms-dev/cms/issues)
