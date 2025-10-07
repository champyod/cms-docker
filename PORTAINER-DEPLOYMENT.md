# CMS Portainer Deployment Guide

## Quick Deployment Steps

### 1. Add Stack in Portainer

1. Navigate to **Stacks** in your Portainer interface
2. Click **Add stack**
3. Choose **Git Repository** as the deployment method

### 2. Repository Configuration

- **Repository URL**: `https://github.com/your-username/cms-docker.git`
- **Reference**: `main` (or your preferred branch)
- **Compose path**: `docker-compose.yml`

### 3. Environment Variables

Copy and paste these environment variables into Portainer's environment section:

```env
# Database Configuration
POSTGRES_DB=cmsdb
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=your-secure-password-123

# CMS Configuration
CMS_SECRET_KEY=generate-new-secret-key-here
CMS_DOMAIN=your-domain.com
CMS_TORNADO_DEBUG=false

# Service Ports
HTTP_PORT=80
HTTPS_PORT=443
CMS_CONTEST_PORT=8888
CMS_ADMIN_PORT=8889
CMS_RANKING_PORT=8890

# Ranking Authentication
CMS_RANKING_USERNAME=admin
CMS_RANKING_PASSWORD=ranking-secure-password

# System Configuration
CMS_NUM_WORKERS=4
CMS_MAX_SUBMISSION_LENGTH=100000
CMS_MAX_INPUT_LENGTH=5000000
```

### 4. Advanced Configuration (Optional)

```env
# Storage Paths (use defaults unless you have specific needs)
CMS_LOG_DIR=/opt/cms/log
CMS_CACHE_DIR=/opt/cms/cache
CMS_DATA_DIR=/opt/cms/lib
CMS_RUN_DIR=/opt/cms/run

# Web Server Configuration
CMS_CONTEST_LISTEN_ADDRESS=0.0.0.0
CMS_ADMIN_LISTEN_ADDRESS=0.0.0.0
CMS_RANKING_BIND_ADDRESS=0.0.0.0

# Cookie Durations (in seconds)
CMS_CONTEST_COOKIE_DURATION=10800
CMS_ADMIN_COOKIE_DURATION=36000
```

### 5. Deploy

Click **Deploy the stack** and wait for all services to start.

## Post-Deployment

### Service URLs

After successful deployment, access your CMS instance at:

- **Main Site**: `http://your-domain/` (redirects to contest)
- **Contest Interface**: `http://your-domain/contest`
- **Admin Interface**: `http://your-domain/admin` 
- **Scoreboard**: `http://your-domain/ranking`

### Initial Setup

1. **Admin Login**: Access `/admin` to create administrator accounts
2. **Contest Setup**: Create your first contest through the admin interface
3. **User Management**: Add participants and configure teams

## Security Checklist

Before production use:

- [ ] Change all default passwords
- [ ] Generate a new secret key for `CMS_SECRET_KEY`
- [ ] Set `CMS_DOMAIN` to your actual domain
- [ ] Configure SSL certificates if using HTTPS
- [ ] Review and adjust file size limits
- [ ] Configure firewall rules if needed

## Monitoring

Check service health in Portainer:

1. Go to **Stacks** → **Your CMS Stack**
2. Monitor container status and logs
3. Check volume usage under **Volumes**

## Troubleshooting

### Common Issues

**Database Connection Failed**
- Check `POSTGRES_PASSWORD` is set correctly
- Verify postgres container is healthy
- Check network connectivity between containers

**Web Interface Not Loading** 
- Verify nginx container is running
- Check port mappings in environment variables
- Review nginx container logs

**Performance Issues**
- Increase `CMS_NUM_WORKERS` for more CPU cores
- Allocate more memory to containers
- Monitor volume disk usage

### Logs Access

In Portainer:
1. Navigate to **Containers**
2. Click on container name
3. Select **Logs** tab
4. Filter by service: `cms-core`, `cms-ranking`, `postgres`, `nginx`

## Updates

To update CMS:

1. In Portainer, go to your stack
2. Click **Editor** 
3. Update the Git reference to newer version
4. Click **Update the stack**
5. Monitor deployment progress

## Backup

Important volumes to backup:
- `postgres_data`: All contest and user data
- `cms_data`: Submissions and contest files
- `contest_data`: Contest definitions

Use Portainer's volume backup feature or external backup solutions.

## Support

- [CMS Documentation](https://cms.readthedocs.io/)
- [Portainer Documentation](https://documentation.portainer.io/)
- [Docker Compose Reference](https://docs.docker.com/compose/)
