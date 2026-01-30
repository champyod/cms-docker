# Troubleshooting Guide

<!--
Author: CCYod
Repository: https://github.com/champyod/cms-docker
-->

Common issues and solutions for CMS Docker deployment.

## Table of Contents

- [General Issues](#general-issues)
- [Installation Problems](#installation-problems)
- [Network Issues](#network-issues)
- [Database Issues](#database-issues)
- [Service Issues](#service-issues)
- [Worker Issues](#worker-issues)
- [Performance Issues](#performance-issues)
- [Security Issues](#security-issues)

---

## General Issues

### Can't Access Web Interface

**Problem**: Unable to access CMS web interfaces via browser.

**Diagnosis:**

```bash
# 1. Check if containers are running
docker ps --filter "name=cms-"

# 2. Check service logs
docker logs cms-contest-web-server-1
docker logs cms-admin-web-server

# 3. Check if ports are listening
sudo netstat -tulpn | grep -E '8888|8889|8890'

# 4. Test local access
curl http://localhost:8888
curl http://localhost:8889
curl http://localhost:8890
```

**Solutions:**

**A. Services not running:**
```bash
# Restart services
docker compose -f docker-compose.contest.yml restart
docker compose -f docker-compose.admin.yml restart
```

**B. Firewall blocking:**
```bash
# Check firewall status
sudo ufw status

# Allow ports
sudo ufw allow 8888/tcp
sudo ufw allow 8889/tcp
sudo ufw allow 8890/tcp
sudo ufw reload
```

**C. Port already in use:**
```bash
# Find what's using the port
sudo lsof -i :8888

# Kill the process or change CMS port
# Edit .env.contest
CONTEST_PORT_EXTERNAL=8887
```

**D. Wrong IP address:**
```bash
# Get your public IP
curl ifconfig.me

# Update .env files with correct IP
PUBLIC_IP=your.actual.ip
```

**E. Cloud provider firewall:**
```bash
# AWS - Check security groups
# GCP - Check firewall rules
# Azure - Check network security groups
# Ensure ports 8888-8890 are open from 0.0.0.0/0
```

---

## Installation Problems

### Docker Not Found

**Problem**: `docker: command not found`

**Solution:**

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
```

### Docker Compose Not Found

**Problem**: `docker-compose: command not found`

**Solution:**

```bash
# For Docker Compose Plugin (recommended)
sudo apt-get update
sudo apt-get install docker-compose-plugin

# Verify
docker compose version

# For standalone docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### Permission Denied

**Problem**: `Got permission denied while trying to connect to the Docker daemon socket`

**Solution:**

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again, or:
newgrp docker

# Or use sudo (not recommended)
sudo docker ps
```

### Build Fails

**Problem**: Docker build fails with errors.

**Diagnosis:**

```bash
# Check disk space
df -h

# Check build logs
docker build -t cms:latest . 2>&1 | tee build.log
```

**Solutions:**

**A. Out of disk space:**
```bash
# Clean up Docker
docker system prune -a -f
docker volume prune -f

# Remove old images
docker image prune -a
```

**B. Network issues during build:**
```bash
# Use cache
docker build --network=host -t cms:latest .

# Retry with verbose output
docker build --progress=plain --no-cache -t cms:latest .
```

**C. Missing git submodules:**
```bash
# Initialize submodules
git submodule update --init --recursive
```

---

## Network Issues

### Containers Can't Communicate

**Problem**: Services can't connect to each other.

**Diagnosis:**

```bash
# Check if containers are on same network
docker network inspect cms-network

# Test connectivity
docker exec cms-contest-web-server-1 ping cms-database
docker exec cms-worker ping cms-log-service
```

**Solutions:**

```bash
# Recreate network
docker network rm cms-network
docker network create cms-network

# Redeploy services
docker compose -f docker-compose.core.yml up -d
```

### DNS Resolution Fails

**Problem**: Containers can't resolve service names.

**Solution:**

```bash
# Use Docker's embedded DNS
# Ensure containers use correct network

# Restart Docker daemon
sudo systemctl restart docker

# Recreate containers
docker compose -f docker-compose.core.yml down
docker compose -f docker-compose.core.yml up -d
```

### Remote Workers Can't Connect

**Problem**: Workers can't connect to main server.

See **[WORKER-SETUP.md](WORKER-SETUP.md#troubleshooting)** for detailed solutions.

**Quick checks:**

```bash
# From worker machine
ping MAIN_SERVER_IP
telnet MAIN_SERVER_IP 22000

# Check main server firewall
sudo ufw status
```

---

## Database Issues

### Database Connection Failed

**Problem**: Services can't connect to database.

**Diagnosis:**

```bash
# Check database status
docker ps --filter "name=cms-database"
docker logs cms-database

# Test connection
docker exec cms-database pg_isready -U cmsuser
```

**Solutions:**

**A. Database not ready:**
```bash
# Wait for database to start
sleep 30

# Check health
docker exec cms-database pg_isready -U cmsuser
```

**B. Wrong credentials:**
```bash
# Check .env file
cat .env | grep POSTGRES

# Ensure consistency across all .env files
POSTGRES_DB=cmsdb
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=your_password
```

**C. Database not initialized:**
```bash
# Initialize database
docker exec cms-log-service cmsInitDB
```

**D. Database corrupted:**
```bash
# Stop all services
./scripts/stop-all.sh

# Remove database volume
docker volume rm cms-db-data

# Redeploy and reinitialize
docker compose -f docker-compose.core.yml up -d
sleep 30
docker exec cms-log-service cmsInitDB
```

### Database Out of Space

**Problem**: Database errors due to disk space.

**Diagnosis:**

```bash
# Check volume usage
docker system df -v

# Check disk space
df -h
```

**Solutions:**

```bash
# Clean up old data
docker exec cms-database vacuumdb -U cmsuser -d cmsdb

# Increase disk space (cloud provider)
# AWS: Modify EBS volume
# GCP: Resize persistent disk
# Then resize filesystem:
sudo resize2fs /dev/sda1
```

### Can't Create Admin User

**Problem**: `cmsAddAdmin` fails.

**Diagnosis:**

```bash
# Check if database is initialized
docker exec cms-database psql -U cmsuser -d cmsdb -c "\dt"

# Check logs
docker logs cms-admin-web-server
```

**Solutions:**

```bash
# Ensure database is initialized
docker exec cms-log-service cmsInitDB

# Create admin user
docker exec -it cms-admin-web-server cmsAddAdmin username

# If still fails, check database connection
docker exec cms-admin-web-server cat /usr/local/etc/cms.conf
```

---

## Service Issues

### Service Keeps Restarting

**Problem**: Container in restart loop.

**Diagnosis:**

```bash
# Check status
docker ps -a --filter "name=cms-"

# Check logs
docker logs --tail 100 CONTAINER_NAME

# Check restart count
docker inspect CONTAINER_NAME | grep RestartCount
```

**Solutions:**

**A. Configuration error:**
```bash
# Check config
docker exec CONTAINER_NAME cat /usr/local/etc/cms.conf

# Validate JSON
cat config/cms.conf | python3 -m json.tool
```

**B. Resource limits:**
```bash
# Check resource usage
docker stats CONTAINER_NAME

# Increase limits in docker-compose file
deploy:
  resources:
    limits:
      memory: 4g
      cpus: '4'
```

**C. Dependency not ready:**
```bash
# Ensure services start in order
docker compose -f docker-compose.core.yml up -d
sleep 30  # Wait for database
docker compose -f docker-compose.admin.yml up -d
```

### Service Not Responding

**Problem**: Service running but not responding.

**Diagnosis:**

```bash
# Check if process is running inside container
docker exec CONTAINER_NAME ps aux

# Check network
docker exec CONTAINER_NAME netstat -tulpn
```

**Solutions:**

```bash
# Restart service
docker restart CONTAINER_NAME

# Check logs for errors
docker logs -f CONTAINER_NAME

# Recreate container
docker compose -f docker-compose.FILE.yml up -d --force-recreate
```

### Logs Show Errors

**Problem**: Error messages in logs.

**Common errors and solutions:**

**A. "Address already in use":**
```bash
# Find conflicting process
sudo lsof -i :PORT

# Kill process or change port
kill -9 PID
```

**B. "Permission denied":**
```bash
# Check volume permissions
docker exec CONTAINER_NAME ls -la /var/local/log/cms

# Fix permissions
docker exec CONTAINER_NAME chown -R cmsuser:cmsuser /var/local/log/cms
```

**C. "Connection refused":**
```bash
# Check if target service is running
docker ps | grep TARGET_SERVICE

# Check network connectivity
docker exec CONTAINER_NAME ping TARGET_SERVICE
```

---

## Worker Issues

### Worker Not Evaluating

**Problem**: Submissions stuck in queue.

**Diagnosis:**

```bash
# Check worker status
docker logs cms-worker

# Check if worker is registered
docker exec cms-resource-service cmsResourceService -l
```

**Solutions:**

```bash
# Restart worker
docker restart cms-worker

# Check worker connection
docker exec cms-worker ping cms-log-service

# Ensure worker shard is unique
# Check .env.worker
WORKER_SHARD=0  # Must be unique
```

### Worker Sandbox Errors

**Problem**: Evaluation fails with sandbox errors.

**Solutions:**

```bash
# Ensure privileged mode
# In docker-compose.worker.yml:
privileged: true
security_opt:
  - seccomp:unconfined
  - apparmor:unconfined

# Check kernel version
uname -r
# Should be 3.10+

# Check cgroups
docker exec cms-worker mount | grep cgroup
```

### Worker Out of Memory

**Problem**: Worker crashes during evaluation.

**Solutions:**

```bash
# Increase memory limit
# In .env.worker:
WORKER_MEMORY=8g

# Check memory usage
docker stats cms-worker

# Reduce parallel evaluations
# In cms.conf:
"max_jobs_per_worker": 1
```

---

## Performance Issues

### Slow Response Times

**Problem**: Web interfaces are slow.

**Diagnosis:**

```bash
# Check resource usage
docker stats

# Check database queries
docker exec cms-database pg_stat_activity

# Check network latency
ping YOUR_SERVER_IP
```

**Solutions:**

**A. Insufficient resources:**
```bash
# Increase container limits
# In docker-compose files
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 8g
```

**B. Database performance:**
```bash
# Optimize database
docker exec cms-database vacuumdb -U cmsuser -d cmsdb -z

# Add indexes (if needed)
docker exec cms-database psql -U cmsuser -d cmsdb
```

**C. Too many connections:**
```bash
# Check connection count
docker exec cms-database psql -U cmsuser -d cmsdb -c \
  "SELECT count(*) FROM pg_stat_activity;"

# Increase max connections
# Edit cms.conf database section
"max_connections": 200
```

### High CPU Usage

**Problem**: Services using too much CPU.

**Diagnosis:**

```bash
# Check CPU usage
docker stats --no-stream

# Check what's using CPU inside container
docker exec CONTAINER_NAME top
```

**Solutions:**

```bash
# Set CPU limits
# In docker-compose files
deploy:
  resources:
    limits:
      cpus: '2.0'
    reservations:
      cpus: '1.0'

# Scale horizontally instead
# Add more workers or contest servers
```

### Disk Space Issues

**Problem**: Running out of disk space.

**Diagnosis:**

```bash
# Check disk usage
df -h

# Check Docker usage
docker system df

# Check volume usage
docker system df -v
```

**Solutions:**

```bash
# Clean up Docker
docker system prune -a -f
docker volume prune -f

# Clean up logs
docker exec cms-log-service find /var/local/log/cms -name "*.log" -mtime +7 -delete

# Set log rotation
# Create /etc/logrotate.d/cms-docker
```

---

## Security Issues

### Unauthorized Access

**Problem**: Security concerns or unauthorized access.

**Solutions:**

```bash
# Change database password
docker exec cms-database psql -U cmsuser -c \
  "ALTER USER cmsuser WITH PASSWORD 'new_secure_password';"

# Update .env files with new password

# Regenerate secret keys
openssl rand -hex 32
# Update .env.contest files

# Restrict firewall
sudo ufw default deny incoming
sudo ufw allow 22/tcp  # SSH only from your IP
sudo ufw allow from YOUR_IP to any port 8888
sudo ufw allow from YOUR_IP to any port 8889
sudo ufw reload
```

### SSL/TLS Issues

**Problem**: HTTPS not working or certificate errors.

**Solutions:**

```bash
# Check certificate expiration
openssl x509 -in cert.pem -noout -dates

# Renew Let's Encrypt certificates
sudo certbot renew

# Test SSL configuration
curl -vI https://contest.example.com
```

---

## Diagnostic Commands

### Health Check Script

```bash
#!/bin/bash
# health-check.sh

echo "=== CMS Health Check ==="
echo

echo "1. Docker status:"
docker ps --filter "name=cms-" --format "table {{.Names}}\t{{.Status}}"
echo

echo "2. Database connection:"
docker exec cms-database pg_isready -U cmsuser
echo

echo "3. Disk space:"
df -h | grep -E 'Filesystem|/dev/'
echo

echo "4. Memory usage:"
free -h
echo

echo "5. Service ports:"
sudo netstat -tulpn | grep -E '8888|8889|8890|5432'
echo

echo "6. Recent errors:"
docker logs --tail 20 cms-log-service 2>&1 | grep -i error
echo
```

### Log Collection Script

```bash
#!/bin/bash
# collect-logs.sh

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="cms-logs-$TIMESTAMP"

mkdir -p $LOG_DIR

# Collect container logs
for container in $(docker ps --filter "name=cms-" --format "{{.Names}}"); do
  docker logs $container > "$LOG_DIR/${container}.log" 2>&1
done

# Collect system info
docker ps > "$LOG_DIR/containers.txt"
docker network ls > "$LOG_DIR/networks.txt"
docker volume ls > "$LOG_DIR/volumes.txt"
df -h > "$LOG_DIR/disk.txt"
free -h > "$LOG_DIR/memory.txt"

# Create archive
tar czf "cms-logs-$TIMESTAMP.tar.gz" $LOG_DIR
echo "Logs collected in: cms-logs-$TIMESTAMP.tar.gz"
```

---

## Getting Help

If you can't solve the issue:

1. **Collect logs:**
   ```bash
   ./collect-logs.sh
   ```

2. **Check documentation:**
   - [Tutorial](TUTORIAL.md)
   - [Worker Setup](WORKER-SETUP.md)
   - [Access Configuration](ACCESS-CONFIGURATION.md)

3. **Ask for help:**
   - 💬 [Telegram Community](https://t.me/contestms)
   - 📧 Email: contestms-support@googlegroups.com
   - 🐛 [GitHub Issues](https://github.com/cms-dev/cms/issues)

4. **Include information:**
   - Operating system and version
   - Docker and Docker Compose versions
   - Complete error messages
   - Relevant logs
   - Steps to reproduce

---

## Support Resources

- 📖 [Full Documentation](../README.md)
- 🚀 [Tutorial](TUTORIAL.md)
- 📦 [Portainer Guide](PORTAINER-GUIDE.md)
- 🌐 [Access Configuration](ACCESS-CONFIGURATION.md)
- 📋 [Quick Reference](QUICKREF.md)
- 🌍 [Worker Setup](WORKER-SETUP.md)
