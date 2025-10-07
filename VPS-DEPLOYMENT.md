# CMS VPS + Raspberry Pi Deployment Guide

## Architecture Overview

This deployment consists of:
- **Main VPS Server**: Running core CMS services + 1 worker via Portainer
- **Raspberry Pi Workers**: Multiple Pi devices connecting to the VPS as additional workers
- **Public Port Access**: Direct port access (no domain required initially)

## VPS Server Setup (Portainer)

### Step 1: Deploy Main Stack in Portainer

1. In Portainer, go to **Stacks** → **Add stack**
2. Choose **Git Repository**
3. Repository URL: `https://github.com/your-username/cms-docker.git`
4. Compose path: `docker-compose.yml`

### Step 2: Configure Environment Variables

**Essential Variables for VPS:**

```env
# Replace with your actual VPS public IP
VPS_PUBLIC_IP=123.456.789.123
VPS_HOSTNAME=123.456.789.123

# Database Configuration
POSTGRES_DB=cmsdb
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=your-secure-db-password-123
POSTGRES_PUBLIC_PORT=5432

# CMS Configuration
CMS_SECRET_KEY=generate-new-32-char-hex-key-here
CMS_TORNADO_DEBUG=false

# Public Ports (No Domain)
CMS_CONTEST_PUBLIC_PORT=8888
CMS_ADMIN_PUBLIC_PORT=8889
CMS_RANKING_PUBLIC_PORT=8890

# Service Ports for Raspberry Pi connections
CMS_LOG_SERVICE_PORT=29000
CMS_RESOURCE_SERVICE_PORT=28000
CMS_SCORING_SERVICE_PORT=28500
CMS_EVALUATION_SERVICE_PORT=25000
CMS_PROXY_SERVICE_PORT=28600

# VPS Worker Configuration (typically just 1)
CMS_NUM_WORKERS=1

# Ranking Authentication
CMS_RANKING_USERNAME=admin
CMS_RANKING_PASSWORD=ranking-secure-password-123

# Disable nginx for direct port access
USE_NGINX=false

# Admin Credentials
CMS_ADMIN_USERNAME=admin
CMS_ADMIN_PASSWORD=admin-secure-password-123
```

### Step 3: Configure VPS Firewall

**Required open ports on your VPS:**

```bash
# Web interfaces (public access)
ufw allow 8888/tcp  # Contest interface
ufw allow 8889/tcp  # Admin interface  
ufw allow 8890/tcp  # Ranking/scoreboard

# Database (for Raspberry Pi workers)
ufw allow 5432/tcp  

# CMS Services (for Raspberry Pi workers)
ufw allow 29000/tcp  # LogService
ufw allow 28000/tcp  # ResourceService
ufw allow 28500/tcp  # ScoringService
ufw allow 25000/tcp  # EvaluationService
ufw allow 28600/tcp  # ProxyService

# Enable firewall
ufw enable
```

### Step 4: Deploy and Verify

1. Click **Deploy the stack** in Portainer
2. Wait for all services to start (check container logs)
3. Verify access:
   - Contest: `http://YOUR_VPS_IP:8888`
   - Admin: `http://YOUR_VPS_IP:8889`
   - Ranking: `http://YOUR_VPS_IP:8890`

## Raspberry Pi Worker Setup

### Step 1: Download Setup Script

On each Raspberry Pi:

```bash
# Download the setup script
curl -O https://raw.githubusercontent.com/your-username/cms-docker/main/setup-raspberry-pi-worker.sh

# Make it executable
chmod +x setup-raspberry-pi-worker.sh

# Run the setup
sudo ./setup-raspberry-pi-worker.sh
```

### Step 2: Configuration During Setup

The script will prompt for:

1. **VPS Public IP**: Your VPS IP address
2. **Database credentials**: Same as configured in Portainer
3. **Worker ID**: Unique number for each Pi (1, 2, 3, etc.)
4. **Worker Port**: Auto-calculated based on ID (26001, 26002, etc.)

### Step 3: Worker Management

After setup, use these commands on each Pi:

```bash
# Start worker
cms-worker-start

# Check status  
cms-worker-status

# View logs
cms-worker-logs

# Stop worker
cms-worker-stop

# Restart worker
cms-worker-restart
```

## Complete Deployment Example

### VPS Configuration (Portainer Environment Variables)

```env
# Network
VPS_PUBLIC_IP=192.168.1.100
VPS_HOSTNAME=192.168.1.100

# Database  
POSTGRES_DB=contestdb
POSTGRES_USER=cms_admin
POSTGRES_PASSWORD=SuperSecure123!
POSTGRES_PUBLIC_PORT=5432

# Security
CMS_SECRET_KEY=a1b2c3d4e5f6789012345678901234ab
CMS_ADMIN_USERNAME=contest_admin
CMS_ADMIN_PASSWORD=AdminPass123!
CMS_RANKING_USERNAME=ranking_admin
CMS_RANKING_PASSWORD=RankingPass123!

# Ports
CMS_CONTEST_PUBLIC_PORT=8888
CMS_ADMIN_PUBLIC_PORT=8889
CMS_RANKING_PUBLIC_PORT=8890

# Services
CMS_LOG_SERVICE_PORT=29000
CMS_RESOURCE_SERVICE_PORT=28000
CMS_SCORING_SERVICE_PORT=28500
CMS_EVALUATION_SERVICE_PORT=25000
CMS_PROXY_SERVICE_PORT=28600

# Workers
CMS_NUM_WORKERS=1
USE_NGINX=false
```

### Pi Worker Example Configuration

When running the setup script on Raspberry Pi #1:

```
VPS Public IP: 192.168.1.100
Database Name: contestdb
Database Username: cms_admin
Database Password: SuperSecure123!
Worker ID: 1
Worker Port: 26001
Worker Name: raspberrypi-worker-1
```

## Access URLs After Deployment

- **Contest Interface**: `http://192.168.1.100:8888`
- **Admin Interface**: `http://192.168.1.100:8889`
- **Scoreboard**: `http://192.168.1.100:8890`

## Future Domain Setup

When you get a domain:

1. Update environment variables:
   ```env
   CMS_DOMAIN=your-domain.com
   USE_NGINX=true
   ```

2. Enable nginx profile in docker-compose:
   ```bash
   docker-compose --profile nginx up -d
   ```

3. Configure DNS A records:
   ```
   your-domain.com → VPS_PUBLIC_IP
   contest.your-domain.com → VPS_PUBLIC_IP  
   admin.your-domain.com → VPS_PUBLIC_IP
   ranking.your-domain.com → VPS_PUBLIC_IP
   ```

## Monitoring and Maintenance

### Check System Status

**On VPS (via Portainer):**
- Monitor container health in Stacks view
- Check logs for each service
- Monitor volume usage

**On Raspberry Pi:**
```bash
cms-worker-status
```

### Scaling Workers

To add more Raspberry Pi workers:
1. Run setup script on new Pi with unique Worker ID
2. No changes needed on VPS side
3. Workers automatically register with ResourceService

### Performance Tuning

**VPS Resources:**
- Monitor CPU/memory usage in Portainer
- Increase container limits if needed
- Consider SSD storage for database

**Raspberry Pi Workers:**
- Ensure good cooling for sustained loads
- Use Class 10 SD cards or USB storage
- Monitor temperature: `vcgencmd measure_temp`

## Troubleshooting

### VPS Issues

**Database connection failures:**
```bash
# Test from Pi
pg_isready -h VPS_IP -p 5432 -U cms_admin
```

**Service not accessible:**
- Check firewall rules
- Verify port mappings in Portainer
- Check container logs

### Raspberry Pi Issues

**Worker won't connect:**
```bash
# Check connectivity
telnet VPS_IP 28000
telnet VPS_IP 5432

# Check logs
cms-worker-logs
```

**Performance issues:**
- Reduce worker sandbox memory limits
- Check SD card performance
- Monitor system resources: `htop`

## Security Considerations

1. **Change all default passwords**
2. **Use strong database passwords**
3. **Consider VPN for Pi-to-VPS communication**
4. **Regular security updates on all systems**
5. **Monitor access logs**
6. **Backup database regularly**

## Backup Strategy

**VPS Data (via Portainer):**
- Database: `postgres_data` volume
- Contest files: `cms_data` volume
- Logs: `cms_log` volume

**Automated backup script:**
```bash
# Create backup script for regular database dumps
docker exec cms-postgres pg_dump -U cms_admin contestdb > backup_$(date +%Y%m%d).sql
```
