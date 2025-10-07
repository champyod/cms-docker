# CMS Docker Deployment Guide

## Overview

This repository contains a Docker Compose configuration for deploying the Contest Management System (CMS) using Portainer. CMS is a comprehensive platform for organizing programming contests with support for:

- **Contest Web Server**: Interface for participants to submit solutions
- **Admin Web Server**: Administrative interface for contest management  
- **Ranking Web Server**: Real-time scoreboard and rankings
- **Evaluation System**: Automated judging of submissions
- **Worker Services**: Sandboxed execution of contestant code
- **PostgreSQL Database**: Persistent storage for all contest data

## Architecture

The deployment consists of the following services:

1. **postgres**: PostgreSQL 15 database with proper CMS permissions
2. **cms-core**: Main CMS application with all core services
3. **cms-ranking**: Dedicated ranking web server
4. **nginx**: Reverse proxy for routing traffic

## Quick Deployment with Portainer

### Step 1: Clone Repository

In Portainer, create a new stack and link it to this Git repository:

```
Repository URL: https://github.com/your-username/cms-docker.git
```

### Step 2: Configure Environment Variables

Copy the environment variables from `.env.sample` and customize them:

```bash
# Database
POSTGRES_DB=cmsdb
POSTGRES_USER=cmsuser
POSTGRES_PASSWORD=your-secure-password-here

# CMS Configuration
CMS_SECRET_KEY=generate-new-secret-key
CMS_DOMAIN=your-domain.com

# Ranking Authentication
CMS_RANKING_USERNAME=admin
CMS_RANKING_PASSWORD=ranking-password

# Ports (adjust if needed)
HTTP_PORT=80
HTTPS_PORT=443
CMS_CONTEST_PORT=8888
CMS_ADMIN_PORT=8889
CMS_RANKING_PORT=8890
```

### Step 3: Deploy the Stack

1. In Portainer, go to **Stacks** → **Add stack**
2. Choose **Git Repository** as the method
3. Enter the repository URL and branch
4. Set the **Compose path** to `docker-compose.yml`
5. Add your environment variables in the **Environment variables** section
6. Click **Deploy the stack**

### Step 4: Access the Services

After deployment, access the services at:

- **Contest Interface**: `http://your-domain/contest` (Port 8888)
- **Admin Interface**: `http://your-domain/admin` (Port 8889)  
- **Ranking/Scoreboard**: `http://your-domain/ranking` (Port 8890)

## Environment Variables Reference

### Required Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | Database password | `changeme123!` |
| `CMS_SECRET_KEY` | Session encryption key | Generate new |
| `CMS_DOMAIN` | Your domain name | `localhost` |

### Database Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_DB` | Database name | `cmsdb` |
| `POSTGRES_USER` | Database user | `cmsuser` |
| `POSTGRES_PORT` | Database port | `5432` |

### Service Ports

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTP_PORT` | HTTP port for nginx | `80` |
| `HTTPS_PORT` | HTTPS port for nginx | `443` |
| `CMS_CONTEST_PORT` | Contest web server | `8888` |
| `CMS_ADMIN_PORT` | Admin web server | `8889` |
| `CMS_RANKING_PORT` | Ranking web server | `8890` |

### System Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `CMS_NUM_WORKERS` | Number of worker processes | `4` |
| `CMS_MAX_SUBMISSION_LENGTH` | Max submission file size (bytes) | `100000` |
| `CMS_MAX_INPUT_LENGTH` | Max test input size (bytes) | `5000000` |

## SSL/TLS Configuration

To enable HTTPS:

1. Place SSL certificates in the `nginx/ssl/` directory:
   - `cert.pem`: SSL certificate
   - `key.pem`: Private key

2. Uncomment the HTTPS server block in `nginx/nginx.conf.template`

3. Update the environment variable:
   ```
   HTTPS_PORT=443
   ```

## Persistent Data

The following volumes are created for data persistence:

- `postgres_data`: Database files
- `cms_log`: Application logs
- `cms_cache`: Cached compilation files
- `cms_data`: Contest data and submissions
- `cms_run`: Runtime files
- `contest_data`: Contest definitions and test cases

## Security Considerations

⚠️ **Important Security Notes:**

1. **Change default passwords** before production use
2. **Generate a new secret key** using:
   ```python
   python -c 'from cmscommon import crypto; print(crypto.get_hex_random_key())'
   ```
3. **Use HTTPS** in production with valid SSL certificates
4. **Restrict database access** to the application network
5. **Regularly update** the base images and dependencies

## Troubleshooting

### Database Connection Issues

If CMS can't connect to the database:

1. Check that PostgreSQL is healthy: `docker logs cms-postgres`
2. Verify environment variables are set correctly
3. Ensure the database initialization completed successfully

### Service Startup Issues

If CMS services fail to start:

1. Check container logs: `docker logs cms-core`
2. Verify all required directories are created
3. Ensure the database schema is initialized (`cmsInitDB`)

### Performance Issues

For better performance:

1. Increase `CMS_NUM_WORKERS` based on CPU cores
2. Allocate more memory to the postgres container
3. Use SSD storage for database volumes

## Development Mode

For development with hot reloading:

```bash
# Set debug mode
CMS_TORNADO_DEBUG=true

# Use the development docker-compose
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Support

For CMS-specific documentation and support:

- [Official CMS Documentation](https://cms.readthedocs.io/)
- [CMS GitHub Repository](https://github.com/cms-dev/cms)
- [Docker Documentation](https://docs.docker.com/)
- [Portainer Documentation](https://documentation.portainer.io/)
