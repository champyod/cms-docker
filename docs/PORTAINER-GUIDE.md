# CMS Docker - Portainer Deployment Guide

<!--
Author: CCYod
Repository: https://github.com/champyod/cms-docker
-->

## 📦 Deploying CMS with Portainer

This guide shows how to deploy CMS using Portainer's web interface.

## Prerequisites

- Portainer installed and running
- Access to Portainer web interface
- Docker environment configured in Portainer

## Deployment Order

Deploy stacks in this order:
1. **Core Services** (required first)
2. **Admin Services**
3. **Contest Services** (one per contest)
4. **Worker Services** (scalable)

---

## Stack 1: Core Services

### Step-by-Step

1. **Navigate to Stacks**
   - Click "Stacks" in the left sidebar
   - Click "+ Add stack"

2. **Configure Stack**
   - **Name**: `cms-core`
   - **Build method**: "Upload" or "Web editor"

3. **Upload/Paste Compose File**
   - Upload: Choose `docker-compose.core.yml`
   - Or paste the contents in web editor

4. **Add Environment Variables**

   Click "Add an environment variable" for each:

   ```
   POSTGRES_DB=cmsdb
   POSTGRES_USER=cmsuser
   POSTGRES_PASSWORD=CHANGE_THIS_PASSWORD
   POSTGRES_HOST_AUTH_METHOD=md5
   CMS_CONFIG=/usr/local/etc/cms.conf
   LOG_SERVICE_SHARD=0
   RESOURCE_SERVICE_SHARD=0
   SCORING_SERVICE_SHARD=0
   EVALUATION_SERVICE_SHARD=0
   PROXY_SERVICE_SHARD=0
   CHECKER_SERVICE_SHARD=0
   ```

   ⚠️ **Important**: Change `POSTGRES_PASSWORD` to a strong password!

5. **Deploy Stack**
   - Click "Deploy the stack"
   - Wait for all services to start (green status)

6. **Verify Deployment**
   - Click on the stack name
   - Check all services are "running"
   - View logs if any service fails

7. **Initialize Database**
   - Go to "Containers"
   - Find `cms-log-service`
   - Click "Console" → "Connect"
   - Choose `/bin/bash`
   - Run: `cmsInitDB`

---

## Stack 2: Admin Services

### Prerequisites
- Core services must be running and healthy

### Step-by-Step

1. **Create New Stack**
   - Name: `cms-admin`
   - Upload/paste `docker-compose.admin.yml`

2. **Environment Variables**

   ```
   CMS_CONFIG=/usr/local/etc/cms.conf
   CMS_RANKING_CONFIG=/usr/local/etc/cms.ranking.conf
   ADMIN_WEB_SERVER_SHARD=0
   ADMIN_LISTEN_ADDRESS=0.0.0.0
   ADMIN_LISTEN_PORT=8889
   ADMIN_PORT_EXTERNAL=8889
   ADMIN_DOMAIN=admin.cms.local
   ADMIN_COOKIE_DURATION=36000
   RANKING_LISTEN_ADDRESS=0.0.0.0
   RANKING_LISTEN_PORT=8890
   RANKING_PORT_EXTERNAL=8890
   RANKING_DOMAIN=ranking.cms.local
   PRINTING_SERVICE_SHARD=0
   PRINTING_ENABLED=false
   ```

3. **Deploy Stack**

4. **Create Admin User**
   - Open console for `cms-admin-web-server`
   - Run: `cmsAddAdmin your_username`
   - Follow prompts to set password

5. **Access Admin Interface**
   - Open browser: `http://your-server-ip:8889`
   - Login with created credentials

---

## Stack 3: Contest Services

### Prerequisites
- Core services running
- Contest created in database (via admin interface)

### Deploy First Contest

1. **Create New Stack**
   - Name: `cms-contest-1`
   - Upload/paste `docker-compose.contest.yml`

2. **Generate Secret Key**
   
   Open a terminal and run:
   ```bash
   python3 -c 'import secrets; print(secrets.token_hex(16))'
   ```
   Copy the output.

3. **Environment Variables**

   ```
   CMS_CONFIG=/usr/local/etc/cms.conf
   CONTEST_ID=1
   CONTEST_WEB_SERVER_SHARD=0
   CONTEST_LISTEN_ADDRESS=0.0.0.0
   CONTEST_LISTEN_PORT=8888
   CONTEST_PORT_EXTERNAL=8888
   CONTEST_DOMAIN=contest.cms.local
   SECRET_KEY=PASTE_GENERATED_KEY_HERE
   COOKIE_DURATION=10800
   MAX_SUBMISSION_LENGTH=100000
   MAX_INPUT_LENGTH=5000000
   SUBMIT_LOCAL_COPY=true
   NUM_PROXIES_USED=0
   ENABLE_TLS=false
   CONTEST_WEB_CPU_LIMIT=2
   CONTEST_WEB_MEMORY_LIMIT=2G
   CONTEST_WEB_CPU_RESERVATION=0.5
   CONTEST_WEB_MEMORY_RESERVATION=512M
   ```

4. **Deploy Stack**

5. **Access Contest Interface**
   - Open browser: `http://your-server-ip:8888`

### Deploy Additional Contests

Repeat the process for each contest:

- Stack name: `cms-contest-2`, `cms-contest-3`, etc.
- Change environment variables:
  - `CONTEST_ID=2` (increment for each)
  - `CONTEST_PORT_EXTERNAL=8887` (different port)
  - Generate **new** `SECRET_KEY` for each contest
  
---

## Stack 4: Worker Services

### Deploy Local Workers

1. **Create New Stack**
   - Name: `cms-worker-0`
   - Upload/paste `docker-compose.worker.yml`

2. **Environment Variables**

   ```
   CORE_SERVICES_HOST=cms-log-service
   CMS_CONFIG=/usr/local/etc/cms.conf
   WORKER_SHARD=0
   WORKER_NAME=worker-0
   KEEP_SANDBOX=false
   MAX_FILE_SIZE=1048576
   WORKER_CPU_LIMIT=4
   WORKER_MEMORY_LIMIT=4G
   WORKER_CPU_RESERVATION=1
   WORKER_MEMORY_RESERVATION=1G
   WORKER_REPLICAS=1
   ```

3. **Deploy Stack**

### Deploy Additional Workers

For better performance, deploy multiple workers:

**Worker 1:**
- Stack name: `cms-worker-1`
- Environment: Same as above, but change:
  - `WORKER_SHARD=1`
  - `WORKER_NAME=worker-1`

**Worker 2:**
- Stack name: `cms-worker-2`
- Environment variables:
  - `WORKER_SHARD=2`
  - `WORKER_NAME=worker-2`

Continue as needed.

---

## Remote Workers (VPS/Cloud)

### On Remote Machine

1. **Install Docker** (if not installed)
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   ```

2. **Install Portainer Agent** (optional, for management)
   ```bash
   docker run -d -p 9001:9001 --name portainer_agent \
     --restart=always \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v /var/lib/docker/volumes:/var/lib/docker/volumes \
     portainer/agent:latest
   ```

3. **Use Auto-Connect Script**
   
   Download and run the worker connection script:
   ```bash
   curl -fsSL http://YOUR-MAIN-SERVER/scripts/worker-connect.sh | sudo bash
   ```
   
   Or manually:
   ```bash
   wget http://YOUR-MAIN-SERVER/scripts/worker-connect.sh
   chmod +x worker-connect.sh
   sudo ./worker-connect.sh
   ```

4. **Follow Prompts**
   - Enter your main CMS server IP
   - Choose worker shard number (10, 11, 12... for remote workers)
   - Let the script complete

### Add Remote Environment to Portainer

1. **Add Environment**
   - In Portainer, go to "Environments"
   - Click "Add environment"
   - Choose "Docker Standalone"
   - Select "Agent"
   - Enter remote machine details

2. **Deploy Worker Stack**
   - Switch to remote environment
   - Deploy `cms-worker` stack
   - Use environment variables:
     ```
     CORE_SERVICES_HOST=MAIN_SERVER_IP
     WORKER_SHARD=10
     WORKER_NAME=remote-worker-10
     ```

---

## Configuration Files

### Upload Configuration via Portainer

1. **Navigate to Volumes**
   - Click "Volumes" in sidebar
   - Find `cms-logs`, `cms-cache`, etc.

2. **Browse Volume**
   - Click on volume name
   - Use "Browse" to view/upload files

### Update CMS Configuration

**Option 1: Via Console**
1. Open console for any CMS container
2. Edit: `nano /usr/local/etc/cms.conf`
3. Save and restart services

**Option 2: Via Volume Upload**
1. Browse the volume containing configs
2. Upload updated `cms.conf`
3. Restart affected stacks

---

## Monitoring and Management

### View Logs

1. **Navigate to Stack**
   - Click "Stacks"
   - Click on stack name

2. **View Service Logs**
   - Click on a service
   - Click "Logs"
   - Toggle "Auto-refresh" for live logs

### Check Service Health

1. **Stack Overview**
   - Green icon = running
   - Red icon = stopped/error
   - Yellow icon = starting

2. **Container Stats**
   - Go to "Containers"
   - View CPU, Memory, Network usage

### Restart Services

1. **Single Container**
   - Go to "Containers"
   - Click container name
   - Click "Restart"

2. **Entire Stack**
   - Go to "Stacks"
   - Click stack name
   - Click "Stop" then "Start"

---

## Scaling

### Scale Workers

**Method 1: Deploy More Stacks**
- Create `cms-worker-3`, `cms-worker-4`, etc.
- Ensure unique `WORKER_SHARD` for each

**Method 2: Use Replicas** (Docker Swarm)
1. Convert environment to Swarm mode
2. In stack editor, add:
   ```yaml
   deploy:
     replicas: 4
   ```

### Scale Contest Servers

Deploy multiple contest stacks:
- `cms-contest-1` on port 8888
- `cms-contest-2` on port 8887
- `cms-contest-3` on port 8886

Use Nginx or Traefik for load balancing.

---

## Backup and Restore

### Backup via Portainer

1. **Volumes Backup**
   - Go to "Volumes"
   - Select volume (e.g., `cms-database-data`)
   - Click "Export"

2. **Stack Configuration Backup**
   - Go to "Stacks"
   - Click stack name
   - Click "Editor"
   - Copy the compose file and env vars

### Database Backup

1. **Open Console** for `cms-database`
2. Run:
   ```bash
   pg_dump -U cmsuser cmsdb > /tmp/backup.sql
   ```
3. **Download** backup file via volume browser

### Restore Database

1. Upload backup to volume
2. Open console for `cms-database`
3. Run:
   ```bash
   psql -U cmsuser cmsdb < /path/to/backup.sql
   ```

---

## Troubleshooting

### Services Won't Start

1. **Check Logs**
   - Stack → Service → Logs
   - Look for error messages

2. **Common Issues**
   - Port already in use: Change `*_PORT_EXTERNAL`
   - Network not found: Deploy core stack first
   - Volume permission: Check container user permissions

### Can't Access Web Interface

1. **Check Container Status**
   - Ensure container is running (green)

2. **Check Port Mappings**
   - Container → Network → Published Ports

3. **Firewall Issues**
   - Open required ports on host firewall

### Database Connection Errors

1. **Verify Password**
   - Check env vars match in all stacks
   - Update `cms.conf` if needed

2. **Check Network**
   - All containers should be on `cms-network`

### Worker Not Connecting

1. **Check Core Services**
   - Ensure core stack is healthy

2. **Verify Configuration**
   - Worker env: `CORE_SERVICES_HOST` correct?
   - Network connectivity to core services

3. **Check Logs**
   - Worker logs for connection errors
   - ResourceService logs for worker registration

---

## Advanced: Templates

### Create Stack Templates

1. **Save Configuration**
   - Create custom templates for recurring deployments
   - Go to "App Templates"
   - Create new template

2. **Template Example** (Contest Stack)
   ```json
   {
     "type": 3,
     "title": "CMS Contest",
     "description": "Contest web server",
     "repository": {
       "url": "https://github.com/your-repo",
       "stackfile": "docker-compose.contest.yml"
     },
     "env": [
       {
         "name": "CONTEST_ID",
         "label": "Contest ID"
       },
       {
         "name": "SECRET_KEY",
         "label": "Secret Key"
       }
     ]
   }
   ```

---

## Security Best Practices

### Portainer Access

1. **Enable HTTPS**
   - Settings → SSL certificate
   - Upload certificate

2. **User Management**
   - Create separate users for admins
   - Use Teams for access control

3. **Registry Management**
   - Store images in private registry
   - Configure registry access

### Network Security

1. **Use Custom Networks**
   - Already configured in compose files

2. **Restrict External Access**
   - Only expose necessary ports
   - Use reverse proxy for public access

3. **Secrets Management**
   - Use Portainer secrets for passwords
   - Don't store passwords in env vars (production)

---

## Quick Reference

### Stack Deployment Order
1. ✅ Core Services (`cms-core`)
2. ✅ Admin Services (`cms-admin`)
3. ✅ Contest Services (`cms-contest-1`, `cms-contest-2`, ...)
4. ✅ Worker Services (`cms-worker-0`, `cms-worker-1`, ...)

### Required Environment Variables

**All Stacks:**
- `CMS_CONFIG=/usr/local/etc/cms.conf`

**Core:**
- `POSTGRES_PASSWORD` (change this!)

**Contest:**
- `CONTEST_ID` (unique per contest)
- `SECRET_KEY` (generate new for each)
- `CONTEST_PORT_EXTERNAL` (unique per contest)

**Worker:**
- `WORKER_SHARD` (unique per worker)
- `WORKER_NAME` (unique identifier)

### Default Ports
- Contest: 8888
- Admin: 8889
- Ranking: 8890
- Database: 5432

---

## Getting Help

- **Portainer Docs**: https://docs.portainer.io/
- **CMS Docs**: https://cms.readthedocs.io/
- **CMS Telegram**: https://t.me/contestms

---

**Happy Deploying! 🚀**
